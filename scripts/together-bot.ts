/**
 * A stand-in second headset for testing shared readings: it speaks the same
 * protocol with the same code as the app (src/net), with a reading machine
 * of its own.
 *
 *   npx tsx scripts/together-bot.ts host watch --steps "wait-guest; choose past-present-future; shuffle; done; draw; turn 0 up"
 *   npx tsx scripts/together-bot.ts join 472913 --out .tmp/bot-state.json
 *
 * Environment: RELAY (default ws://localhost:8787), ORIGIN (default https://localhost:8081).
 */

import { readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import WebSocket from 'ws';
import type { Mode } from '../src/net/permissions.ts';
import { fromWire, parseMessage, PROTOCOL_VERSION, toWire, type Msg, type Obj, type Q4, type V3 } from '../src/net/protocol.ts';
import { RelayClient } from '../src/net/relayClient.ts';
import { newRoomCode } from '../src/net/roomCode.ts';
import { deriveRoom, open, seal, type PeerRole } from '../src/net/secure.ts';
import { SyncTracker } from '../src/net/sync.ts';
import { ReadingMachine } from '../src/state/readingMachine.ts';
import type { SpreadDef } from '../src/spreads/spread.schema.ts';

const RELAY = process.env.RELAY ?? 'ws://localhost:8787';
const ORIGIN = process.env.ORIGIN ?? 'https://localhost:8081';
const root = join(import.meta.dirname, '..');
const cards = JSON.parse(readFileSync(join(root, 'src/data/cards.json'), 'utf8')) as { id: string }[];
const cardIds = cards.map((c) => c.id);
const spreads = new Map<string, SpreadDef>(
  readdirSync(join(root, 'src/spreads'))
    .filter((f) => f.endsWith('.json'))
    .map((f) => {
      const s = JSON.parse(readFileSync(join(root, 'src/spreads', f), 'utf8'));
      return [s.id, { ...s, origin: 'builtin' }];
    }),
);

class OriginSocket extends WebSocket {
  constructor(url: string) {
    super(url, { headers: { Origin: ORIGIN } });
  }
}

const [, , roleArg, arg, ...rest] = process.argv;
const option = (name: string) => {
  const i = rest.indexOf(`--${name}`);
  return i >= 0 ? rest[i + 1] : undefined;
};
const role: PeerRole = roleArg === 'join' ? 'guest' : 'host';
const mode: Mode = roleArg === 'host' && arg === 'shuffle' ? 'shuffle' : 'watch';
const code = role === 'host' ? (option('code') ?? newRoomCode()) : arg;
const out = option('out');
const steps = (option('steps') ?? '').split(';').map((s) => s.trim()).filter(Boolean);
const log = (...args: unknown[]) => console.log(`[bot ${role}]`, ...args);

const machine = new ReadingMachine({ cardIds, reversalChance: 0.5 });
machine.send({ type: 'MAT_PLACED' });
const tracker = new SyncTracker();
const epoch = Math.random().toString(16).slice(2, 10);
let seq = 0;
let peer = false;
let hid = 1;
const received: Msg[] = [];
const ctx = { isCardId: (id: string) => cardIds.includes(id) };

const room = await deriveRoom(code);
const from: PeerRole = role === 'host' ? 'guest' : 'host';
let chain = Promise.resolve();
const send = (msg: Msg) => {
  chain = chain.then(async () => void relay.send(await seal(room, role, msg)));
  return chain;
};
const dump = () => {
  if (out) writeFileSync(out, JSON.stringify({ shared: machine.exportShared(), synced: tracker.status, received: received.map((m) => m.t) }, null, 2));
};

if (role === 'host') {
  machine.subscribe((snapshot, event, origin) => {
    if (origin === 'remote') return;
    const wire = toWire(event, snapshot);
    if (!wire) return;
    seq++;
    if (peer) void send({ t: 'ev', seq, ev: wire });
  });
}
machine.subscribe(() => dump());

const relay = new RelayClient({
  url: RELAY,
  roomId: room.roomId,
  role,
  WebSocketImpl: OriginSocket as unknown as typeof globalThis.WebSocket,
  handlers: {
    onOpen: () => log('connected', role === 'host' ? `CODE=${code}` : ''),
    onControl: (c) => {
      peer = c.r === 'welcome' ? c.peer : c.present;
      log('peer', peer);
      if (peer && role === 'guest') {
        void send({ t: 'hello', v: PROTOCOL_VERSION, role, deck: 'rws-1909' });
        void send({ t: 'sync-req', why: 'join' });
        tracker.requested(0);
      }
      if (peer && role === 'host') void send({ t: 'hello', v: PROTOCOL_VERSION, role, deck: 'rws-1909', mode, epoch });
    },
    onFrame: async (frame) => {
      const raw = await open(room, frame, from);
      const msg = raw && parseMessage(raw, ctx);
      if (!msg) return log('dropped a frame');
      received.push(msg);
      handle(msg);
    },
    onClose: (reason, final) => log('closed', reason, final ? '(final)' : '(retrying)'),
  },
});
relay.connect();

function sendState() {
  void send({ t: 'state', epoch, seq, mode, reading: machine.exportShared(), holds: [] });
}

function handle(msg: Msg) {
  if (msg.t === 'pose') return; // noisy
  log('got', msg.t, msg.t === 'ev' ? `${msg.ev.type} seq=${msg.seq}` : msg.t === 'hold' ? `${msg.obj} on=${msg.on}` : '');
  if (role === 'host') {
    if (msg.t === 'hello' || msg.t === 'sync-req') sendState();
    if (msg.t === 'intent') {
      if (mode === 'shuffle' && machine.send({ type: 'SHUFFLE', passes: 1 }, 'intent')) {
        setTimeout(() => machine.send({ type: 'SHUFFLE_DONE' }), 800);
      } else void send({ t: 'nack', id: msg.id, why: 'not-allowed' });
    }
    return;
  }
  if (msg.t === 'state') {
    if (machine.restore(msg.reading)) tracker.onState(msg.epoch, msg.seq);
    dump();
  }
  if (msg.t === 'ev') {
    const d = tracker.onEvent(msg.seq);
    if (d === 'apply' && !machine.send(fromWire(msg.ev), 'remote')) tracker.markUnsynced();
    if (tracker.status === 'unsynced') {
      void send({ t: 'sync-req', why: 'gap' });
      tracker.requested(0);
    }
    dump();
  }
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
async function waitFor(check: () => boolean, ms = 30_000) {
  const until = Date.now() + ms;
  while (!check()) {
    if (Date.now() > until) throw new Error('timed out');
    await sleep(50);
  }
}

/** Stream a hold on `obj` from `p0` to `p1` over `ms`, wiggling if asked. */
async function stream(obj: Obj, p0: V3, p1: V3, ms: number, shake = 0) {
  const id = hid++;
  const rn = machine.current.readingNumber;
  const q: Q4 = [0, 0, 0, 1];
  await send({ t: 'hold', rn, hid: id, obj, on: true, p: p0, q });
  const start = Date.now();
  while (Date.now() - start < ms) {
    const k = (Date.now() - start) / ms;
    const wiggle = shake ? Math.sin(k * Math.PI * 2 * shake) * 0.06 : 0;
    const p: V3 = [p0[0] + (p1[0] - p0[0]) * k + wiggle, p0[1] + (p1[1] - p0[1]) * k, p0[2] + (p1[2] - p0[2]) * k];
    await send({ t: 'pose', rn, hid: id, obj, p, q, ts: Date.now() / 1000 });
    await sleep(50);
  }
  return { id, rn, q };
}

for (const step of steps) {
  const [cmd, ...a] = step.split(/\s+/);
  log('step:', step);
  switch (cmd) {
    case 'wait-guest':
    case 'wait-peer':
      await waitFor(() => peer);
      break;
    case 'wait-synced':
      await waitFor(() => tracker.status === 'synced');
      break;
    case 'sleep':
      await sleep(Number(a[0]));
      break;
    case 'choose':
      machine.send({ type: 'CHOOSE_SPREAD', spread: spreads.get(a[0])! });
      break;
    case 'shuffle':
      machine.send({ type: 'SHUFFLE', passes: a[0] === '1' ? 1 : 2 });
      break;
    case 'done':
      machine.send({ type: 'SHUFFLE_DONE' });
      break;
    case 'draw':
      machine.send({ type: 'DRAW', toHand: a[0] === 'hand' });
      break;
    case 'turn':
      machine.send({ type: 'TURN', slot: Number(a[0]), faceUp: a[1] === 'up' });
      break;
    case 'new':
      machine.send({ type: 'NEW_READING' });
      break;
    case 'intent':
      await send({ t: 'intent', id: hid++, ev: { type: 'SHUFFLE' } });
      break;
    case 'gap':
      // Forge a skipped sequence number, to check the guest asks to catch up.
      seq += 2;
      break;
    case 'hold-card': {
      // hold-card <slot> <x> <z>: pick the card up, move it over 1 s, turn it, let go.
      const slot = Number(a[0]);
      const p0: V3 = [Number(a[1]), 0.12, Number(a[2])];
      const { id, rn } = await stream(slot, p0, [p0[0], 0.2, p0[2] + 0.05], 1000);
      const flipped: Q4 = [0, 0, 1, 0];
      if (a[3] === 'up') machine.send({ type: 'TURN', slot, faceUp: true });
      await send({ t: 'hold', rn, hid: id, obj: slot, on: false, p: [p0[0], 0.2, p0[2] + 0.05], q: flipped });
      break;
    }
    case 'shake-deck': {
      // shake-deck <x> <z>: lift the deck, shake it for 1.5 s, ask to shuffle, put it down.
      const p0: V3 = [Number(a[0]), 0.15, Number(a[1])];
      const { id, rn, q } = await stream('deck', p0, p0, 1500, 6);
      await send({ t: 'intent', id: hid++, ev: { type: 'SHUFFLE' } });
      await sleep(400);
      await send({ t: 'hold', rn, hid: id, obj: 'deck', on: false, p: p0, q });
      break;
    }
    case 'stale-pose':
      // A pose from an earlier reading, which must be ignored.
      await send({ t: 'pose', rn: 0, hid: 999, obj: 'deck', p: [0, 0.3, 0], q: [0, 0, 0, 1], ts: Date.now() / 1000 });
      break;
    case 'print':
      log(JSON.stringify(machine.exportShared()));
      break;
    case 'quit':
      relay.close();
      process.exit(0);
  }
}
log('steps done; staying connected (Ctrl-C to stop)');
