// Smoke test for the relay. Start it first:  npm run dev   (port 8787)
// Then:  npm run smoke   (or RELAY=https://... ORIGIN=https://... npm run smoke)
import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import WebSocket from 'ws';

const RELAY = process.env.RELAY ?? 'http://localhost:8787';
const ORIGIN = process.env.ORIGIN ?? 'https://localhost:8081';
const wsBase = RELAY.replace(/^http/, 'ws');
const room = () => randomBytes(16).toString('hex');

function connect(roomId, role, origin = ORIGIN) {
  const ws = new WebSocket(`${wsBase}/v1/room/${roomId}?role=${role}`, { headers: { Origin: origin } });
  const inbox = [];
  const waiters = [];
  ws.binaryType = 'nodebuffer';
  ws.on('message', (data, isBinary) => {
    const item = isBinary ? { bin: Buffer.from(data) } : { text: data.toString() };
    const waiter = waiters.shift();
    if (waiter) waiter(item);
    else inbox.push(item);
  });
  const closed = new Promise((resolve) => ws.on('close', (code) => resolve(code)));
  const opened = new Promise((resolve, reject) => {
    ws.on('open', resolve);
    ws.on('unexpected-response', (_req, res) => reject(new Error(`status ${res.statusCode}`)));
    ws.on('error', () => {});
  });
  const next = (ms = 3000) =>
    inbox.length
      ? Promise.resolve(inbox.shift())
      : new Promise((resolve, reject) => {
          const t = setTimeout(() => reject(new Error('timed out waiting for a message')), ms);
          waiters.push((item) => (clearTimeout(t), resolve(item)));
        });
  return { ws, opened, closed, next };
}

const json = async (peer) => JSON.parse((await peer.next()).text);
let passed = 0;
async function check(name, fn) {
  await fn();
  passed++;
  console.log(`✓ ${name}`);
}

await check('health', async () => {
  const res = await fetch(`${RELAY}/health`);
  assert.equal(await res.text(), 'ok');
});

await check('refuses pages it does not know', async () => {
  const c = connect(room(), 'host', 'https://evil.example');
  await assert.rejects(c.opened, /status 403/);
});

await check('a guest with no host is told so', async () => {
  const c = connect(room(), 'guest');
  assert.equal(await c.closed, 4001);
});

const r = room();
const host = connect(r, 'host');
const guest = connect(r, 'guest');

await check('host and guest meet', async () => {
  await host.opened;
  assert.deepEqual(await json(host), { r: 'welcome', peer: false });
  await guest.opened;
  assert.deepEqual(await json(guest), { r: 'welcome', peer: true });
  assert.deepEqual(await json(host), { r: 'peer', present: true });
});

await check('frames pass through unchanged, both ways', async () => {
  const a = randomBytes(300);
  host.ws.send(a);
  assert.ok((await guest.next()).bin.equals(a));
  const b = randomBytes(5000);
  guest.ws.send(b);
  assert.ok((await host.next()).bin.equals(b));
});

await check('ping gets pong', async () => {
  guest.ws.send('ping');
  assert.equal((await guest.next()).text, 'pong');
});

await check('a second host or guest is refused', async () => {
  assert.equal(await connect(r, 'host').closed, 4002);
  assert.equal(await connect(r, 'guest').closed, 4003);
});

await check('the host hears when the guest leaves', async () => {
  guest.ws.close();
  assert.deepEqual(await json(host), { r: 'peer', present: false });
});

await check('frames over 16 KiB close the connection', async () => {
  const g = connect(r, 'guest');
  await g.opened;
  await g.next(); // welcome
  await host.next(); // peer present
  g.ws.send(randomBytes(17 * 1024));
  assert.equal(await g.closed, 1009);
  assert.deepEqual(await json(host), { r: 'peer', present: false });
});

await check('stray text closes the connection', async () => {
  const g = connect(r, 'guest');
  await g.opened;
  await g.next();
  await host.next();
  g.ws.send('hello');
  assert.equal(await g.closed, 4004);
  await host.next();
});

await check('a flood is cut off', async () => {
  const g = connect(r, 'guest');
  await g.opened;
  await g.next();
  await host.next();
  for (let i = 0; i < 300; i++) g.ws.send(Buffer.from([i & 255]));
  assert.equal(await g.closed, 4008);
});

host.ws.close();
console.log(`\n${passed} relay checks passed`);
process.exit(0);
