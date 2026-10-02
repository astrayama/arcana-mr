import { createSystem, type Object3D } from '@iwsdk/core';
import { app } from '../app/context.js';
import { allowed, gateFor, type Mode } from '../net/permissions.js';
import {
  fromWire,
  parseMessage,
  PROTOCOL_VERSION,
  toWire,
  type HoldState,
  type Msg,
  type Obj,
  type ParseContext,
  type Q4,
  type V3,
} from '../net/protocol.js';
import { RelayClient, type CloseReason } from '../net/relayClient.js';
import { newRoomCode } from '../net/roomCode.js';
import { deriveRoom, open, seal, type PeerRole, type Room } from '../net/secure.js';
import { permissionContext, session, SOLO, type Session, type SessionProblem } from '../net/session.js';
import { SyncTracker } from '../net/sync.js';
import type { ReadingEvent, ReadingSnapshot, ResolvedEvent, Origin } from '../state/readingMachine.js';
import { CardInteractionSystem } from './cardInteractionSystem.js';
import { DeckSystem } from './deckSystem.js';
import { DrawSystem } from './drawSystem.js';
import { motionNow, TableGrabSystem, type RemoteHold } from './tableGrabSystem.js';
import type { TableCard } from './tableSystem.js';

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
/** Fewest seconds between poses of something moving in the hand (about 20 a second). */
const POSE_INTERVAL_S = 0.05;
/** A pose at least this often while the hand holds still, so the other side knows it's still held. */
const POSE_KEEPALIVE_S = 0.25;
/** Smallest move worth sending, in meters, and turn, as 1 - |q1·q2| (about half a degree). */
const POSE_MOVED_M = 0.001;
const POSE_TURNED = 1e-5;
/** Something the other person holds is put back if nothing is heard about it for this long. */
const REMOTE_STALE_S = 2;
/** How long a card pulled into the other person's hand waits for their hand before flying to its spot. */
const PULL_WAIT_S = 1;

/** Something this headset holds, as last sent. */
interface Outgoing {
  obj: Obj;
  hid: number;
  rn: number;
  object: Object3D;
  sentAt: number;
  readonly p: V3;
  readonly q: Q4;
}

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
  private readonly inbox: { msg: Msg; from: PeerRole }[] = [];
  /** Host: anyone (the guest or a screen viewer) is here to hear what happens. */
  private anyone = false;
  /** Guest: what they chose when joining. */
  private wants: Mode = 'watch';
  private sendChain: Promise<void> = Promise.resolve();
  private recvChain: Promise<void> = Promise.resolve();
  private readonly tracker = new SyncTracker();
  private epoch = '';
  private seq = 0;
  private lastStateAt = -Infinity;
  /** A guest asked for the state too soon after the last one; send it when allowed. */
  private stateOwed = false;
  private intent: { id: number; at: number } | null = null;
  /** Starts somewhere random, so two people asking at once don't share ids. */
  private nextIntentId = 1 + Math.floor(Math.random() * 1_000_000);
  private time = 0;
  private deck!: DeckSystem;
  private grab!: TableGrabSystem;
  private cards!: CardInteractionSystem;
  /** What this headset holds, by hold id. */
  private readonly outgoing = new Map<number, Outgoing>();
  /** Cards the other person pulled off the deck, waiting for their hand, by spot. */
  private readonly pendingPulls = new Map<number, { card: TableCard; fly: () => void; at: number }>();
  private readonly parseContext: ParseContext = { isCardId: (id) => app.cards.has(id) };

  get available(): boolean {
    return RELAY_URL.length > 0;
  }

  init(): void {
    this.deck = this.world.getSystem(DeckSystem)!;
    this.grab = this.world.getSystem(TableGrabSystem)!;
    this.cards = this.world.getSystem(CardInteractionSystem)!;
    this.grab.holdListener = {
      onHoldStart: (obj, hid, object) => this.holdStarted(obj, hid, object),
      onHoldEnd: (obj, hid, p, q) => this.holdEnded(obj, hid, p, q),
    };
    this.grab.onRemoteDropped = (hold, putBack) => this.remoteDropped(hold, putBack);
    this.world.getSystem(DrawSystem)!.onRemotePull = (card, fly) => this.remotePulled(card, fly);
    app.machine.setGate((event) => this.gate(event));
    // A phone or headset waking up may have missed things: check the line and catch up.
    const woke = () => {
      if (document.visibilityState !== 'visible' || (this.role !== 'guest' && this.role !== 'viewer')) return;
      this.tracker.markUnsynced();
      this.relay?.probe();
    };
    document.addEventListener('visibilitychange', woke);
    this.cleanupFuncs.push(() => document.removeEventListener('visibilitychange', woke));
    this.cleanupFuncs.push(
      app.machine.subscribe((snapshot, event, origin) => this.onReading(snapshot, event, origin)),
      () => this.end(),
    );
  }

  /** Open a room as the host. The guest picks watch or shuffle when they join. */
  async host(mode: Mode = 'watch'): Promise<void> {
    await this.start('host', mode, newRoomCode());
  }

  /** Join a room in a headset, choosing to watch or to shuffle for the reader. */
  async join(code: string, wants: Mode = 'watch'): Promise<void> {
    this.wants = wants;
    await this.start('guest', wants, code);
  }

  /** Watch a room's reading on a phone or computer screen. */
  async watch(code: string): Promise<void> {
    await this.start('viewer', 'watch', code);
  }

  /** The host changes who shuffles, for the guest here now and anyone joining later. */
  setMode(mode: Mode): void {
    if (this.role !== 'host' || session.peek().mode === mode) return;
    this.patchSession({ mode });
    this.send({ t: 'mode', mode });
    // The deck isn't the guest's to hold any more: put it back.
    if (mode === 'watch') this.grab.releaseRemote(true);
  }

  /** Leave the shared reading and carry on alone. */
  leave(): void {
    if (this.role === null) return;
    const wasFollower = this.role !== 'host';
    this.send({ t: 'bye' });
    this.end();
    // A guest keeps the reading that's on the table and can carry it on.
    if (wasFollower) app.machine.adopt();
  }

  update(delta: number): void {
    this.time += delta;
    while (this.inbox.length) this.handle(this.inbox.shift()!);
    if (this.stateOwed && this.role === 'host') this.sendState();
    const s = session.peek();
    if ((this.role === 'guest' || this.role === 'viewer') && s.status === 'connected' && app.machine.state !== 'PLACING') {
      if (this.tracker.shouldRequest(this.time)) {
        this.tracker.requested(this.time);
        this.send({ t: 'sync-req', why: this.tracker.lastSeq < 0 ? 'join' : 'stale' });
      }
    }
    // Followers: whether they're in step with the host, for the screens that show it.
    if (this.role === 'guest' || this.role === 'viewer') {
      const synced = this.tracker.status === 'synced';
      if (s.synced !== synced) this.patchSession({ synced });
    }
    if (this.intent && this.time - this.intent.at > INTENT_TIMEOUT_S) {
      this.intent = null;
      this.deck.intentEnded();
    }
    if (this.outgoing.size > 0 && this.listening()) this.streamPoses();
    if (this.grab.remoteHolds.size > 0) this.dropStaleHolds();
    if (this.pendingPulls.size > 0) this.flyUnclaimedPulls();
  }

  // Session lifecycle

  private async start(role: PeerRole, mode: Mode, code: string, tries = 0): Promise<void> {
    this.anyone = false;
    if (!this.available) {
      this.setSession({ ...SOLO, status: 'ended', problem: 'unavailable' });
      return;
    }
    this.end();
    const generation = ++this.generation;
    this.role = role;
    this.setSession({ role, mode, code, status: 'preparing', peerPresent: false, viewers: 0, synced: false, problem: null });
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
          if (role === 'host') this.audienceChanged(control.guest ?? present, control.viewers ?? 0);
          else this.hostChanged(present);
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
    this.outgoing.clear();
    this.flushPulls(true);
    this.grab.releaseRemote(true);
    this.setSession(SOLO);
  }

  private closed(reason: CloseReason, final: boolean, role: PeerRole, mode: Mode, tries: number): void {
    if (!final) {
      this.anyone = false;
      this.patchSession({ status: 'reconnecting', peerPresent: false, viewers: 0 });
      this.tracker.markUnsynced();
      this.flushPulls(true);
      this.grab.releaseRemote(true);
      return;
    }
    // The code we picked is someone else's room: pick another.
    if (role === 'host' && reason === 'taken' && tries < CODE_TRIES) {
      void this.start('host', mode, newRoomCode(), tries + 1);
      return;
    }
    const problem: SessionProblem = reason === 'lost' ? null : reason;
    const wasFollower = role !== 'host';
    this.end();
    this.setSession({ ...SOLO, status: 'ended', problem });
    if (wasFollower) app.machine.adopt();
  }

  /** The host hears who's here: the headset guest, and how many screen viewers. */
  private audienceChanged(guest: boolean, viewers: number): void {
    const s = session.peek();
    const arrived = (guest && !s.peerPresent) || viewers > s.viewers;
    this.anyone = guest || viewers > 0;
    this.patchSession({ peerPresent: guest, viewers, status: this.anyone ? 'connected' : 'waiting' });
    if (!guest && s.peerPresent) {
      // The guest left: put back whatever they were holding.
      this.flushPulls(true);
      this.grab.releaseRemote(true);
    }
    if (arrived) this.send({ t: 'hello', v: PROTOCOL_VERSION, role: 'host', deck: app.deck.id, mode: s.mode, epoch: this.epoch });
  }

  /** A guest or viewer hears whether the host is here. */
  private hostChanged(present: boolean): void {
    this.patchSession({ peerPresent: present, status: present ? 'connected' : 'alone' });
    if (!present) {
      this.flushPulls(true);
      this.grab.releaseRemote(true);
      return;
    }
    const role = this.role === 'viewer' ? 'viewer' : 'guest';
    this.send({ t: 'hello', v: PROTOCOL_VERSION, role, deck: app.deck.id, ...(role === 'guest' ? { wants: this.wants } : {}) });
    this.tracker.markUnsynced();
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
    const from: readonly PeerRole[] = this.role === 'host' ? ['guest', 'viewer'] : ['host'];
    // Who sent it, from the frame's header (checked as part of the encryption).
    const sender: PeerRole = frame[1] === 2 ? 'viewer' : frame[1] === 1 ? 'guest' : 'host';
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
        this.inbox.push({ msg, from: sender });
      })
      .catch(() => {});
  }

  private handle({ msg, from }: { msg: Msg; from: PeerRole }): void {
    if (this.role === 'host') this.handleAsHost(msg, from);
    else if (this.role !== null) this.handleAsGuest(msg);
  }

  private handleAsHost(msg: Msg, from: PeerRole): void {
    // Screen viewers only ever ask to catch up, or to shuffle.
    if (from === 'viewer' && msg.t !== 'hello' && msg.t !== 'sync-req' && msg.t !== 'intent') return;
    switch (msg.t) {
      case 'hello':
        // The headset guest's choice, made when joining, sets who shuffles.
        if (from === 'guest' && msg.wants) this.setMode(msg.wants);
        this.sendState();
        break;
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
        // The relay says who's still here; nothing to do.
        break;
      default:
        this.onMotion(msg);
    }
  }

  private handleAsGuest(msg: Msg): void {
    switch (msg.t) {
      case 'hello':
        // An older copy of the app on the host's side can't answer us properly.
        if (msg.v !== PROTOCOL_VERSION) {
          this.outdated();
          break;
        }
        if (msg.mode) this.modeChanged(msg.mode);
        break;
      case 'mode':
        this.modeChanged(msg.mode);
        break;
      case 'state': {
        this.modeChanged(msg.mode);
        // Already exactly here (the state was for someone else joining): nothing to redo.
        if (this.tracker.status === 'synced' && msg.epoch === this.tracker.epoch && msg.seq === this.tracker.lastSeq) break;
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
        this.hostChanged(false);
        break;
      default:
        this.onMotion(msg);
    }
  }

  /** The host is running a different version: stop, and say why. */
  private outdated(): void {
    this.end();
    this.setSession({ ...SOLO, status: 'ended', problem: 'outdated' });
    app.machine.adopt();
  }

  /** A guest hears who shuffles now. Losing the shuffle means putting the deck down. */
  private modeChanged(mode: Mode): void {
    if (session.peek().mode === mode) return;
    this.patchSession({ mode });
    if (mode === 'watch' && this.role === 'guest') {
      this.intent = null;
      this.grab.letGoAll();
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
    // The table is being cleared or rebuilt: cards waiting for a hand are gone.
    if (event.type === 'RESTORE' || event.type === 'NEW_READING') this.flushPulls(false);
    if (this.role === 'guest' || this.role === 'viewer') {
      if (event.type === 'MAT_PLACED') this.tracker.markUnsynced();
      if (event.type === 'SHUFFLE' && origin === 'remote' && this.intent) this.intent = null;
      return;
    }
    if (this.role !== 'host' || origin === 'remote') return;
    const wire = toWire(event, snapshot);
    if (!wire) return;
    this.seq++;
    if (this.anyone) this.send({ t: 'ev', seq: this.seq, ev: wire });
  }

  // Motion: cards and the deck moving in someone's hand

  /** Whether anyone will hear motion from this headset: the host's audience, or a guest's host. */
  private listening(): boolean {
    return this.role === 'host' ? this.anyone : session.peek().peerPresent;
  }

  private holdStarted(obj: Obj, hid: number, object: Object3D): void {
    if (this.role === null) return;
    const rn = app.machine.current.readingNumber;
    const { position: p, quaternion: q } = object;
    this.outgoing.set(hid, { obj, hid, rn, object, sentAt: this.time, p: [p.x, p.y, p.z], q: [q.x, q.y, q.z, q.w] });
    if (this.listening()) this.send({ t: 'hold', rn, hid, obj, on: true, p: [p.x, p.y, p.z], q: [q.x, q.y, q.z, q.w] });
  }

  private holdEnded(obj: Obj, hid: number, p: V3, q: Q4): void {
    const out = this.outgoing.get(hid);
    if (!out) return;
    this.outgoing.delete(hid);
    if (this.listening()) this.send({ t: 'hold', rn: out.rn, hid, obj, on: false, p, q });
  }

  /** Send where held things are: about 20 times a second while they move, 4 while they're still. */
  private streamPoses(): void {
    for (const out of this.outgoing.values()) {
      const since = this.time - out.sentAt;
      if (since < POSE_INTERVAL_S) continue;
      const { position: p, quaternion: q } = out.object;
      const moved =
        Math.abs(p.x - out.p[0]) + Math.abs(p.y - out.p[1]) + Math.abs(p.z - out.p[2]) > POSE_MOVED_M ||
        1 - Math.abs(q.x * out.q[0] + q.y * out.q[1] + q.z * out.q[2] + q.w * out.q[3]) > POSE_TURNED;
      if (!moved && since < POSE_KEEPALIVE_S) continue;
      out.p[0] = p.x;
      out.p[1] = p.y;
      out.p[2] = p.z;
      out.q[0] = q.x;
      out.q[1] = q.y;
      out.q[2] = q.z;
      out.q[3] = q.w;
      out.sentAt = this.time;
      this.send({ t: 'pose', rn: out.rn, hid: out.hid, obj: out.obj, p: [p.x, p.y, p.z], q: [q.x, q.y, q.z, q.w], ts: motionNow() });
    }
  }

  private onMotion(msg: Msg): void {
    if (msg.t !== 'hold' && msg.t !== 'pose') return;
    // From an earlier reading: the table has moved on.
    if (msg.rn !== app.machine.current.readingNumber) return;
    if (msg.t === 'pose') this.grab.pushRemotePose(msg.obj, msg.hid, msg.p, msg.q, msg.ts);
    else if (msg.on) this.remoteHoldOn(msg.obj, msg.hid, msg.rn, msg.p, msg.q, false);
    else this.remoteHoldOff(msg.obj, msg.hid, msg.p, msg.q);
  }

  /** A guest catching up: pick up whatever the host is holding right now. */
  private onMotionState(holds: HoldState[], rn: number): void {
    for (const hold of holds) this.remoteHoldOn(hold.obj, hold.hid, rn, hold.p, hold.q, true);
  }

  private remoteHoldOn(obj: Obj, hid: number, rn: number, p: V3, q: Q4, jump: boolean): void {
    // A guest may only ever lift the deck, and only when it's theirs to shuffle.
    if (this.role === 'host') {
      const guest = { role: 'guest', mode: session.peek().mode, peerPresent: true } as const;
      if (obj !== 'deck' || allowed(guest, 'liftDeck') !== 'yes') return;
    }
    // Both reached for it at once: the host keeps it.
    const hold = this.grab.takeRemote(obj, hid, rn, this.role === 'host');
    if (!hold) return;
    if (obj !== 'deck') this.pendingPulls.delete(obj);
    if (jump) setPose(hold.object, p, q);
    if (obj === 'deck') this.deck.remoteHeld(true);
  }

  private remoteHoldOff(obj: Obj, hid: number, p: V3, q: Q4): void {
    const hold = this.grab.endRemote(obj, hid);
    if (!hold) return;
    if (hold.buffer.empty) setPose(hold.object, p, q);
    if (hold.card) this.cards.settleRemote(hold.card);
    else this.deck.remoteHeld(false);
  }

  /** The other person's hold ended without them letting go. */
  private remoteDropped(hold: RemoteHold, putBack: boolean): void {
    if (!hold.card) this.deck.remoteHeld(false);
    else if (putBack) this.cards.settle(hold.card);
  }

  /** Put back anything the other person seems to have stopped holding (their headset went quiet). */
  private dropStaleHolds(): void {
    const now = motionNow();
    for (const hold of this.grab.remoteHolds.values()) {
      if (now - hold.lastAt < REMOTE_STALE_S) continue;
      if (this.grab.endRemote(hold.obj, hold.hid)) this.remoteDropped(hold, true);
    }
  }

  /** The other person pinched a card off the deck: it waits on top of the deck for their hand. */
  private remotePulled(card: TableCard, fly: () => void): void {
    card.phase = 'held';
    card.heldBy = 'remote';
    this.pendingPulls.set(card.slot, { card, fly, at: this.time });
  }

  private flyUnclaimedPulls(): void {
    for (const [slot, pull] of this.pendingPulls) {
      if (this.time - pull.at < PULL_WAIT_S) continue;
      this.pendingPulls.delete(slot);
      pull.card.heldBy = null;
      pull.fly();
    }
  }

  /** Forget cards waiting for the other person's hand, sending them to their spots if `fly`. */
  private flushPulls(fly: boolean): void {
    const pulls = [...this.pendingPulls.values()];
    this.pendingPulls.clear();
    for (const pull of pulls) {
      pull.card.heldBy = null;
      if (fly) pull.fly();
    }
  }

  /** Whether this headset may currently lift the deck (used by the hub and HUD copy). */
  canLiftDeck(): boolean {
    return allowed(permissionContext(), 'liftDeck') === 'yes';
  }
}

function setPose(object: Object3D, p: V3, q: Q4): void {
  object.position.set(p[0], p[1], p[2]);
  object.quaternion.set(q[0], q[1], q[2], q[3]);
}
