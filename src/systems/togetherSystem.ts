import { createSystem } from '@iwsdk/core';
import { app } from '../app/context.js';
import { allowed, gateFor, type Mode } from '../net/permissions.js';
import {
  fromWire,
  parseMessage,
  PROTOCOL_VERSION,
  toWire,
  type Msg,
  type ParseContext,
} from '../net/protocol.js';
import { RelayClient, type CloseReason } from '../net/relayClient.js';
import { newRoomCode } from '../net/roomCode.js';
import { deriveRoom, open, seal, type PeerRole, type Room } from '../net/secure.js';
import { permissionContext, session, SOLO, type Session, type SessionProblem } from '../net/session.js';
import { SyncTracker } from '../net/sync.js';
import type { ReadingEvent, ReadingSnapshot, ResolvedEvent, Origin } from '../state/readingMachine.js';
import { DeckSystem } from './deckSystem.js';
import { TableGrabSystem } from './tableGrabSystem.js';

/** The relay's address for this build, or empty when reading together isn't available. */
export const RELAY_URL = (import.meta.env.VITE_RELAY_URL ?? '').trim();

/** Most messages waiting to be applied before we give up and catch up from scratch. */
const INBOX_LIMIT = 200;
/** How long a guest's shuffle request waits for an answer (seconds). */
const INTENT_TIMEOUT_S = 1.5;
/** Fewest seconds between full states the host sends. */
const STATE_INTERVAL_S = 0.5;
/** Tries at a fresh room code when the one we picked is in use. */
const CODE_TRIES = 4;

const randomHex = (bytes: number) => Array.from(crypto.getRandomValues(new Uint8Array(bytes)), (b) => b.toString(16).padStart(2, '0')).join('');

/**
 * Reading together across two headsets. The host opens a room and reads out
 * its six-digit code; the guest taps it in. The host's reading is the real
 * one: every reading event goes to the guest, in order, and the guest asks
 * for the whole reading whenever it falls out of step. Messages are
 * encrypted with a key made from the code, and the relay only passes them on.
 */
export class TogetherSystem extends createSystem({}) {
  private relay: RelayClient | null = null;
  private room: Room | null = null;
  private role: PeerRole | null = null;
  /** Bumped whenever a session starts or ends, so stale async work can tell. */
  private generation = 0;
  private readonly inbox: Msg[] = [];
  private sendChain: Promise<void> = Promise.resolve();
  private recvChain: Promise<void> = Promise.resolve();
  private readonly tracker = new SyncTracker();
  private epoch = '';
  private seq = 0;
  private lastStateAt = -Infinity;
  /** A guest asked for the state too soon after the last one; send it when allowed. */
  private stateOwed = false;
  private intent: { id: number; at: number } | null = null;
  private nextIntentId = 1;
  private time = 0;
  private deck!: DeckSystem;
  private grab!: TableGrabSystem;
  private readonly parseContext: ParseContext = { isCardId: (id) => app.cards.has(id) };

  get available(): boolean {
    return RELAY_URL.length > 0;
  }

  init(): void {
    this.deck = this.world.getSystem(DeckSystem)!;
    this.grab = this.world.getSystem(TableGrabSystem)!;
    app.machine.setGate((event) => this.gate(event));
    this.cleanupFuncs.push(
      app.machine.subscribe((snapshot, event, origin) => this.onReading(snapshot, event, origin)),
      () => this.end(),
    );
  }

  /** Open a room as the host. */
  async host(mode: Mode): Promise<void> {
    await this.start('host', mode, newRoomCode());
  }

  /** Join a room as the guest. */
  async join(code: string): Promise<void> {
    await this.start('guest', 'watch', code);
  }

  /** Leave the shared reading and carry on alone. */
  leave(): void {
    if (this.role === null) return;
    const wasGuest = this.role === 'guest';
    this.send({ t: 'bye' });
    this.end();
    // A guest keeps the reading that's on the table and can carry it on.
    if (wasGuest) app.machine.adopt();
  }

  update(delta: number): void {
    this.time += delta;
    while (this.inbox.length) this.handle(this.inbox.shift()!);
    if (this.stateOwed && this.role === 'host') this.sendState();
    const s = session.peek();
    if (this.role === 'guest' && s.status === 'connected' && app.machine.state !== 'PLACING') {
      if (this.tracker.shouldRequest(this.time)) {
        this.tracker.requested(this.time);
        this.send({ t: 'sync-req', why: this.tracker.lastSeq < 0 ? 'join' : 'stale' });
      }
    }
    if (this.intent && this.time - this.intent.at > INTENT_TIMEOUT_S) {
      this.intent = null;
      this.deck.intentEnded();
    }
  }

  // Session lifecycle

  private async start(role: PeerRole, mode: Mode, code: string, tries = 0): Promise<void> {
    if (!this.available) {
      this.setSession({ ...SOLO, status: 'ended', problem: 'unavailable' });
      return;
    }
    this.end();
    const generation = ++this.generation;
    this.role = role;
    this.setSession({ role, mode, code, status: 'preparing', peerPresent: false, problem: null });
    const room = await deriveRoom(code);
    if (generation !== this.generation) return;
    this.room = room;
    if (role === 'host') {
      this.epoch = randomHex(8);
      this.seq = 0;
    }
    this.tracker.reset();
    this.patchSession({ status: 'connecting' });
    this.relay = new RelayClient({
      url: RELAY_URL,
      roomId: room.roomId,
      role,
      handlers: {
        onOpen: () => {
          if (generation !== this.generation) return;
          this.patchSession({ status: role === 'host' ? 'waiting' : 'connecting' });
        },
        onControl: (control) => {
          if (generation !== this.generation) return;
          const present = control.r === 'welcome' ? control.peer : control.present;
          this.peerChanged(present);
        },
        onFrame: (frame) => this.receive(frame, generation),
        onClose: (reason, final) => {
          if (generation !== this.generation) return;
          this.closed(reason, final, role, mode, tries);
        },
      },
    });
    this.relay.connect();
  }

  /** Stop everything and go back to reading alone. */
  private end(): void {
    this.generation++;
    this.relay?.close();
    this.relay = null;
    this.room = null;
    this.role = null;
    this.inbox.length = 0;
    this.intent = null;
    this.stateOwed = false;
    this.tracker.reset();
    this.grab.releaseRemote();
    this.setSession(SOLO);
  }

  private closed(reason: CloseReason, final: boolean, role: PeerRole, mode: Mode, tries: number): void {
    if (!final) {
      this.patchSession({ status: 'reconnecting', peerPresent: false });
      this.tracker.markUnsynced();
      this.grab.releaseRemote();
      return;
    }
    // The code we picked is someone else's room: pick another.
    if (role === 'host' && reason === 'taken' && tries < CODE_TRIES) {
      void this.start('host', mode, newRoomCode(), tries + 1);
      return;
    }
    const problem: SessionProblem = reason === 'lost' ? null : reason;
    const wasGuest = role === 'guest';
    this.end();
    this.setSession({ ...SOLO, status: 'ended', problem });
    if (wasGuest) app.machine.adopt();
  }

  private peerChanged(present: boolean): void {
    const s = session.peek();
    this.patchSession({
      peerPresent: present,
      status: present ? 'connected' : s.role === 'host' ? 'waiting' : 'alone',
    });
    if (!present) {
      this.grab.releaseRemote();
      return;
    }
    if (this.role === 'guest') {
      this.send({ t: 'hello', v: PROTOCOL_VERSION, role: 'guest', deck: app.deck.id });
      this.tracker.markUnsynced();
    } else {
      this.send({ t: 'hello', v: PROTOCOL_VERSION, role: 'host', deck: app.deck.id, mode: s.mode, epoch: this.epoch });
    }
  }

  private setSession(next: Session): void {
    session.value = next;
  }

  private patchSession(patch: Partial<Session>): void {
    session.value = { ...session.peek(), ...patch };
  }

  // Messages

  /** Encrypt and send, strictly in order. */
  send(msg: Msg): void {
    const room = this.room;
    const relay = this.relay;
    const role = this.role;
    if (!room || !relay || !role) return;
    this.sendChain = this.sendChain
      .then(async () => {
        const frame = await seal(room, role, msg);
        if (this.relay === relay) relay.send(frame);
      })
      .catch(() => {});
  }

  /** Decrypt, check, and queue for the next frame, strictly in order. */
  private receive(frame: Uint8Array, generation: number): void {
    const room = this.room;
    const from: PeerRole = this.role === 'host' ? 'guest' : 'host';
    if (!room) return;
    this.recvChain = this.recvChain
      .then(async () => {
        const raw = await open(room, frame, from);
        if (generation !== this.generation || raw === null) return;
        const msg = parseMessage(raw, this.parseContext);
        if (!msg) return;
        if (this.inbox.length >= INBOX_LIMIT) {
          // Too far behind (a sleeping headset): drop it all and catch up from scratch.
          this.inbox.length = 0;
          this.tracker.markUnsynced();
          return;
        }
        this.inbox.push(msg);
      })
      .catch(() => {});
  }

  private handle(msg: Msg): void {
    if (this.role === 'host') this.handleAsHost(msg);
    else if (this.role === 'guest') this.handleAsGuest(msg);
  }

  private handleAsHost(msg: Msg): void {
    switch (msg.t) {
      case 'hello':
      case 'sync-req':
        this.sendState();
        break;
      case 'intent': {
        const ctx = permissionContext();
        const ok =
          ctx.mode === 'shuffle' && !this.deck.busy && app.machine.can({ type: 'SHUFFLE' }) && this.deck.requestShuffle('intent');
        if (!ok) this.send({ t: 'nack', id: msg.id, why: ctx.mode === 'shuffle' ? 'not-now' : 'not-allowed' });
        break;
      }
      case 'bye':
        this.peerChanged(false);
        break;
      default:
        this.onMotion(msg);
    }
  }

  private handleAsGuest(msg: Msg): void {
    switch (msg.t) {
      case 'hello':
        if (msg.mode) this.patchSession({ mode: msg.mode });
        break;
      case 'state': {
        this.patchSession({ mode: msg.mode });
        if (app.machine.state === 'PLACING') {
          // Catch up once this headset's mat is down.
          this.tracker.markUnsynced();
          break;
        }
        this.grab.releaseAll();
        if (app.machine.restore(msg.reading)) {
          this.tracker.onState(msg.epoch, msg.seq);
          this.onMotionState(msg.holds, msg.reading.rn);
        } else {
          this.tracker.markUnsynced();
        }
        break;
      }
      case 'ev': {
        const decision = this.tracker.onEvent(msg.seq);
        if (decision !== 'apply') break;
        if (!app.machine.send(fromWire(msg.ev), 'remote')) this.tracker.markUnsynced();
        break;
      }
      case 'nack':
        if (this.intent?.id === msg.id) {
          this.intent = null;
          this.deck.intentEnded();
        }
        break;
      case 'bye':
        this.peerChanged(false);
        break;
      default:
        this.onMotion(msg);
    }
  }

  private sendState(): void {
    if (this.time - this.lastStateAt < STATE_INTERVAL_S) {
      this.stateOwed = true;
      return;
    }
    this.stateOwed = false;
    this.lastStateAt = this.time;
    this.send({
      t: 'state',
      epoch: this.epoch,
      seq: this.seq,
      mode: session.peek().mode,
      reading: app.machine.exportShared(),
      holds: this.grab.localHoldStates(),
    });
  }

  // The reading

  /** What a shared reading's rules say about something done on this headset. */
  private gate(event: ReadingEvent): 'apply' | 'reject' | 'forwarded' {
    const s = session.peek();
    if (s.role === 'solo') return 'apply';
    const decision = gateFor(permissionContext(s), event);
    if (decision !== 'forwarded') return decision;
    // A guest's shuffle goes to the host, one at a time, only while connected.
    if (s.status !== 'connected' || this.intent) return 'reject';
    const id = this.nextIntentId++;
    this.intent = { id, at: this.time };
    this.send({ t: 'intent', id, ev: { type: 'SHUFFLE' } });
    return 'forwarded';
  }

  /** The host shares everything it applies; a guest notices when it needs to catch up. */
  private onReading(snapshot: ReadingSnapshot, event: ResolvedEvent, origin: Origin): void {
    if (this.role === 'guest') {
      if (event.type === 'MAT_PLACED') this.tracker.markUnsynced();
      if (event.type === 'SHUFFLE' && origin === 'remote' && this.intent) this.intent = null;
      return;
    }
    if (this.role !== 'host' || origin === 'remote') return;
    const wire = toWire(event, snapshot);
    if (!wire) return;
    this.seq++;
    if (session.peek().peerPresent) this.send({ t: 'ev', seq: this.seq, ev: wire });
  }

  // Motion (cards and the deck moving in someone's hand) is added next.

  private onMotion(_msg: Msg): void {}

  private onMotionState(_holds: unknown, _rn: number): void {}

  /** Whether this headset may currently lift the deck (used by the hub and HUD copy). */
  canLiftDeck(): boolean {
    return allowed(permissionContext(), 'liftDeck') === 'yes';
  }
}
