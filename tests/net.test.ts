import assert from 'node:assert/strict';
import { mock, test } from 'node:test';
import { allowed, gateFor, type PermissionContext } from '../src/net/permissions.ts';
import { PoseBuffer, type Pose } from '../src/net/poseBuffer.ts';
import { fromWire, parseMessage, toWire } from '../src/net/protocol.ts';
import { classifyClose, RelayClient } from '../src/net/relayClient.ts';
import { formatCode, isRoomCode, newRoomCode, pressKey } from '../src/net/roomCode.ts';
import { deriveRoom, open, seal } from '../src/net/secure.ts';
import { SyncTracker } from '../src/net/sync.ts';
import { ReadingMachine } from '../src/state/readingMachine.ts';
import type { SpreadDef } from '../src/spreads/spread.schema.ts';

const ids = Array.from({ length: 78 }, (_, i) => `card-${i}`);
const ctx = { isCardId: (id: string) => ids.includes(id) };
const three: SpreadDef = {
  id: 'three',
  name: 'Three',
  summary: 'Three cards.',
  origin: 'builtin',
  positions: ['Past', 'Present', 'Future'].map((label, x) => ({ label, meaning: `${label}.`, x: x - 1, y: 0 })),
};

test('room codes are six digits, formatted for reading aloud, typed on a keypad', () => {
  for (let i = 0; i < 50; i++) assert.ok(isRoomCode(newRoomCode()));
  assert.equal(newRoomCode((a) => ((a[0] = 7), a)), '000007');
  assert.equal(formatCode('472913'), '472 913');
  let v = '';
  for (const k of ['4', '7', '2', '9', '1', '3', '5'] as const) v = pressKey(v, k);
  assert.equal(v, '472913', 'a seventh digit is ignored');
  assert.equal(pressKey(v, 'del'), '47291');
  assert.equal(pressKey(v, 'clear'), '');
});

test('the same code gives the same room; frames round-trip and reject the wrong key, tampering, or our own role', async () => {
  const a = await deriveRoom('472913');
  const b = await deriveRoom('472913');
  const other = await deriveRoom('472914');
  assert.match(a.roomId, /^[0-9a-f]{32}$/);
  assert.equal(a.roomId, b.roomId);
  assert.notEqual(a.roomId, other.roomId);
  assert.ok(!a.roomId.includes('472913'), 'the code is not in the room id');
  const frame = await seal(a, 'host', { t: 'bye' });
  assert.deepEqual(await open(b, frame, 'host'), { t: 'bye' });
  assert.equal(await open(other, frame, 'host'), null, 'wrong code');
  assert.equal(await open(b, frame, 'guest'), null, 'not from the role we expect (a reflected frame)');
  const tampered = frame.slice();
  tampered[tampered.length - 1] ^= 1;
  assert.equal(await open(b, tampered, 'host'), null, 'tampered');
  const relabeled = frame.slice();
  relabeled[1] = 1;
  assert.equal(await open(b, relabeled, 'guest'), null, 'the role byte is authenticated');
});

test('messages are checked strictly', () => {
  assert.ok(parseMessage({ t: 'bye' }, ctx));
  assert.ok(parseMessage({ t: 'hello', v: 1, role: 'host', deck: 'rws-1909', mode: 'watch', epoch: 'abc' }, ctx));
  assert.ok(parseMessage({ t: 'pose', rn: 1, hid: 2, obj: 'deck', p: [0, 0.1, 0], q: [0, 0, 0, 1], ts: 12.5 }, ctx));
  assert.ok(parseMessage({ t: 'ev', seq: 3, ev: { type: 'DRAW', slot: 0, cardId: 'card-3', reversed: true, toHand: false } }, ctx));
  assert.ok(parseMessage({ t: 'ev', seq: 3, ev: { type: 'CHOOSE_SPREAD', spread: three, rn: 2 } }, ctx));
  const junk: unknown[] = [
    null,
    'bye',
    { t: 'nope' },
    { t: 'bye', extra: 1 },
    { t: 'pose', rn: 1, hid: 2, obj: 'deck', p: [0, NaN, 0], q: [0, 0, 0, 1], ts: 1 },
    { t: 'pose', rn: 1, hid: 2, obj: 'deck', p: [0, 9, 0], q: [0, 0, 0, 1], ts: 1 },
    { t: 'pose', rn: 1, hid: 2, obj: 12, p: [0, 0, 0], q: [0, 0, 0, 1], ts: 1 },
    { t: 'pose', rn: 1, hid: 2, obj: 'deck', p: [0, 0, 0], q: [0, 0, 0, 2], ts: 1 },
    { t: 'ev', seq: 3, ev: { type: 'DRAW', slot: 0, cardId: 'not-a-card', reversed: true, toHand: false } },
    { t: 'ev', seq: -1, ev: { type: 'NEW_READING' } },
    { t: 'ev', seq: 3, ev: { type: 'CHOOSE_SPREAD', spread: { ...three, positions: [] }, rn: 2 } },
    { t: 'intent', id: 1, ev: { type: 'DRAW' } },
    { t: 'state', epoch: 'e', seq: 0, mode: 'watch', reading: { phase: 'PLACING', spread: null, rn: 0, shuffles: 0, slots: [] }, holds: [] },
  ];
  for (const j of junk) assert.equal(parseMessage(j, ctx), null, JSON.stringify(j));
});

test('a host reading replays exactly on a guest through the wire format', () => {
  const host = new ReadingMachine({ cardIds: ids, reversalChance: 0.5 });
  const guest = new ReadingMachine({ cardIds: ids, reversalChance: 0.5 });
  host.subscribe((snapshot, event) => {
    const wire = toWire(event, snapshot);
    if (wire) {
      const msg = parseMessage(JSON.parse(JSON.stringify({ t: 'ev', seq: 0, ev: wire })), ctx);
      assert.ok(msg && msg.t === 'ev');
      assert.equal(guest.send(fromWire(msg.ev), 'remote'), true, `${event.type} applies`);
    }
  });
  host.send({ type: 'MAT_PLACED' });
  guest.send({ type: 'MAT_PLACED' });
  host.send({ type: 'CHOOSE_SPREAD', spread: three });
  host.send({ type: 'SHUFFLE' });
  host.send({ type: 'SHUFFLE_DONE' });
  host.send({ type: 'DRAW' });
  host.send({ type: 'DRAW', toHand: true });
  host.send({ type: 'SHUFFLE', passes: 1 });
  host.send({ type: 'SHUFFLE_DONE' });
  host.send({ type: 'DRAW' });
  host.send({ type: 'TURN', slot: 2, faceUp: true });
  assert.deepEqual(guest.exportShared(), host.exportShared());
  host.send({ type: 'NEW_READING' });
  assert.equal(guest.state, 'IDLE');
});

test('permissions follow the room mode, and the host has full control without a guest', () => {
  const host = (mode: 'watch' | 'shuffle', peerPresent = true): PermissionContext => ({ role: 'host', mode, peerPresent });
  const guest = (mode: 'watch' | 'shuffle'): PermissionContext => ({ role: 'guest', mode, peerPresent: true });
  assert.equal(allowed({ role: 'solo', mode: 'watch', peerPresent: false }, 'shuffle'), 'yes');
  assert.equal(allowed(host('watch'), 'shuffle'), 'yes');
  assert.equal(allowed(host('shuffle'), 'shuffle'), 'no');
  assert.equal(allowed(host('shuffle'), 'liftDeck'), 'no');
  assert.equal(allowed(host('shuffle'), 'draw'), 'yes');
  assert.equal(allowed(host('shuffle', false), 'shuffle'), 'yes', 'no guest, full control');
  for (const action of ['chooseSpread', 'newReading', 'shuffle', 'draw', 'turn', 'liftDeck', 'grabCard'] as const) {
    assert.equal(allowed(guest('watch'), action), 'no', action);
  }
  assert.equal(allowed(guest('shuffle'), 'shuffle'), 'forward');
  assert.equal(allowed(guest('shuffle'), 'liftDeck'), 'yes');
  assert.equal(allowed(guest('shuffle'), 'draw'), 'no');
  assert.equal(gateFor(guest('watch'), { type: 'MAT_PLACED' }), 'apply', 'placing the mat is always yours');
  assert.equal(gateFor(guest('shuffle'), { type: 'SHUFFLE' }), 'forwarded');
  assert.equal(gateFor(guest('shuffle'), { type: 'SHUFFLE_DONE' }), 'reject');
  assert.equal(gateFor(host('watch'), { type: 'SHUFFLE_DONE' }), 'apply');
});

test('the guest stays in step: duplicates dropped, gaps noticed, retries after a while', () => {
  const s = new SyncTracker();
  assert.equal(s.onEvent(1), 'drop', 'not in step yet');
  assert.equal(s.shouldRequest(0), true);
  s.requested(0);
  assert.equal(s.shouldRequest(1), false);
  assert.equal(s.shouldRequest(4), true, 'ask again after 3 s');
  s.onState('e1', 5);
  assert.equal(s.onEvent(5), 'drop');
  assert.equal(s.onEvent(6), 'apply');
  assert.equal(s.onEvent(8), 'gap');
  assert.equal(s.status, 'unsynced');
  s.onState('e2', 0);
  assert.equal(s.onEvent(1), 'apply', 'a new epoch starts over');
});

test('poses play back smoothly a little behind, and never run far ahead', () => {
  const b = new PoseBuffer();
  const out: Pose = { p: [0, 0, 0], q: [0, 0, 0, 1] };
  assert.equal(b.sample(0, out), false);
  // Sender clock starts at 100; arrives 0.05 s later on our clock (which starts at 0).
  for (let i = 0; i <= 10; i++) b.push({ p: [i * 0.01, 0, 0], q: [0, 0, 0, 1] }, 100 + i * 0.05, i * 0.05 + 0.05);
  b.push({ p: [9, 9, 9], q: [0, 0, 0, 1] }, 100.2, 0.6);
  b.sample(0.05 + 0.1 + 0.125, out); // halfway between samples 2 and 3
  assert.ok(Math.abs(out.p[0] - 0.025) < 1e-9, `${out.p[0]}`);
  b.sample(10, out);
  assert.ok(out.p[0] <= 0.1 + 0.02 + 1e-9, 'extrapolation is capped');
});

test('closing codes: what is retried, and what is final', () => {
  assert.deepEqual(classifyClose(4001, false, 0), { reason: 'no-host', final: true });
  assert.deepEqual(classifyClose(4001, true, 5_000), { reason: 'no-host', final: false });
  assert.deepEqual(classifyClose(4001, true, 61_000), { reason: 'no-host', final: true });
  assert.equal(classifyClose(4002, true, 0).final, true);
  assert.equal(classifyClose(4003, false, 0).final, true);
  assert.equal(classifyClose(1006, true, 0).final, false);
});

class FakeSocket {
  static last: FakeSocket | null = null;
  readyState = 0;
  binaryType = 'blob';
  sent: unknown[] = [];
  onopen: (() => void) | null = null;
  onmessage: ((e: { data: unknown }) => void) | null = null;
  onclose: ((e: { code: number }) => void) | null = null;
  constructor(public url: string) {
    FakeSocket.last = this;
  }
  send(data: unknown) {
    this.sent.push(data);
  }
  close(code = 1000) {
    this.readyState = 3;
    this.onclose?.({ code });
  }
  open() {
    this.readyState = 1;
    this.onopen?.();
  }
}

test('the relay client connects by room id, relays frames, pings, and backs off when dropped', () => {
  mock.timers.enable({ apis: ['setTimeout', 'setInterval'] });
  try {
    const events: string[] = [];
    const client = new RelayClient({
      url: 'wss://relay.example/',
      roomId: 'ab'.repeat(16),
      role: 'guest',
      WebSocketImpl: FakeSocket as unknown as typeof WebSocket,
      random: () => 0.5,
      handlers: {
        onOpen: () => events.push('open'),
        onFrame: (f) => events.push(`frame:${f.length}`),
        onControl: (c) => events.push(`control:${c.r}`),
        onClose: (reason, final) => events.push(`close:${reason}:${final}`),
      },
    });
    client.connect();
    const first = FakeSocket.last!;
    assert.equal(first.url, `wss://relay.example/v1/room/${'ab'.repeat(16)}?role=guest`);
    first.open();
    first.onmessage?.({ data: '{"r":"welcome","peer":true}' });
    first.onmessage?.({ data: new Uint8Array([1, 2, 3]).buffer });
    assert.equal(client.send(new Uint8Array([9])), true);
    mock.timers.tick(15_000);
    assert.equal(first.sent[first.sent.length - 1], 'ping');
    first.close(1006);
    assert.deepEqual(events, ['open', 'control:welcome', 'frame:3', 'close:lost:false']);
    assert.equal(FakeSocket.last, first, 'waits before retrying');
    mock.timers.tick(500);
    assert.notEqual(FakeSocket.last, first, 'retried');
    FakeSocket.last!.close(4003);
    assert.equal(events[events.length - 1], 'close:full:true');
    client.close();
  } finally {
    mock.timers.reset();
  }
});
