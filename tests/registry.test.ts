import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createRegistry, type RegistryItem } from '../src/lib/registry.ts';

interface Item extends RegistryItem {
  name: string;
}

test('built-ins are listed and found', () => {
  const r = createRegistry<Item>([{ id: 'rws-1909', origin: 'builtin', name: 'RWS' }]);
  assert.equal(r.get('rws-1909')?.name, 'RWS');
  assert.equal(r.list().length, 1);
});

test('device items need the device prefix and never replace a built-in', () => {
  const r = createRegistry<Item>([{ id: 'rws-1909', origin: 'builtin', name: 'RWS' }]);
  assert.match(r.register({ id: 'mine', origin: 'device', name: 'x' })!, /device:/);
  assert.match(r.register({ id: 'device:x', origin: 'builtin', name: 'x' })!, /only for device/);
  assert.match(r.register({ id: 'rws-1909', origin: 'builtin', name: 'again' })!, /built in/);
  assert.equal(r.register({ id: 'device:mine', origin: 'device', name: 'Mine' }), null);
  assert.equal(r.get('device:mine')?.name, 'Mine');
});

test('removing or replacing a device item frees it, and listeners hear about it', () => {
  const r = createRegistry<Item>();
  let freed = 0;
  let changes = 0;
  r.onChange(() => changes++);
  r.register({ id: 'device:a', origin: 'device', name: 'a', dispose: () => freed++ });
  r.register({ id: 'device:a', origin: 'device', name: 'a2', dispose: () => freed++ });
  assert.equal(freed, 1, 'the replaced item was freed');
  assert.equal(r.unregister('device:a'), true);
  assert.equal(freed, 2);
  assert.equal(r.unregister('device:a'), false);
  assert.equal(changes, 3);
});

test('built-ins cannot be removed', () => {
  const r = createRegistry<Item>([{ id: 'b', origin: 'builtin', name: 'b' }]);
  assert.equal(r.unregister('b'), false);
  assert.ok(r.get('b'));
});
