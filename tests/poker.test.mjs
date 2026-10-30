import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { EventEmitter } from 'node:events';
import { WebSocket } from 'ws';
import { createStore, csvCell } from '../server/rooms.mjs';
import { attachApi } from '../server/api.mjs';

async function setup(t) {
  const directory = await mkdtemp(path.join(tmpdir(), 'planning-poker-test-'));
  const store = await createStore(directory);
  const server = http.createServer(async (req, res) => { if (!await api.handle(req, res)) { res.writeHead(404); res.end(); } });
  const api = attachApi(server, store);
  server.on('upgrade', (req, socket, head) => { if (!api.upgrade(req, socket, head)) socket.destroy(); });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const base = `http://127.0.0.1:${server.address().port}`;
  const clients = [];
  t.after(async () => { clients.forEach(c => c.socket.terminate()); api.close(); await new Promise(resolve => server.close(resolve)); await store.close(); await rm(directory, { recursive: true, force: true }); });
  async function post(route, data, headers = {}) {
    const response = await fetch(base + route, { method: 'POST', headers: { 'Content-Type': 'application/json', ...headers }, body: JSON.stringify(data) });
    return { status: response.status, body: await response.json() };
  }
  async function connect(identity) {
    const socket = new WebSocket(base.replace('http:', 'ws:') + '/socket', { origin: base });
    const events = new EventEmitter();
    const client = { socket, state: null, errors: [], send: data => socket.send(JSON.stringify(data)) };
    clients.push(client);
    socket.on('message', raw => {
      const message = JSON.parse(raw);
      if (message.type === 'state') client.state = message.state;
      else if (message.type === 'error') client.errors.push(message);
      events.emit('update');
    });
    client.wait = (predicate, description = 'state update') => new Promise((resolve, reject) => {
      let timer;
      const check = () => { if (predicate(client)) { clearTimeout(timer); events.off('update', check); resolve(client.state); } };
      timer = setTimeout(() => { events.off('update', check); reject(new Error(`Timed out waiting for ${description}`)); }, 3000);
      events.on('update', check); check();
    });
    await new Promise((resolve, reject) => { socket.once('open', resolve); socket.once('error', reject); });
    client.send({ type: 'connect', ...identity });
    await client.wait(c => c.state || c.errors.length);
    return client;
  }
  return { store, base, post, connect };
}

test('private votes, host controls, reconnect, agreed estimate and CSV export', async t => {
  const { store, base, post, connect } = await setup(t);
  const created = await post('/api/rooms', { name: 'Joakim' });
  assert.equal(created.status, 201);
  const hostIdentity = created.body;
  const host = await connect(hostIdentity);
  const joined = await post(`/api/rooms/${hostIdentity.roomId}/join`, { name: 'Alex' });
  const guest = await connect(joined.body);
  await host.wait(c => c.state.members.length === 2);
  assert.equal(host.state.isHost, true); assert.equal(guest.state.isHost, false);
  assert.ok(!JSON.stringify(host.state).includes(joined.body.token));
  host.send({ type: 'title', value: 'Inloggning; med "SSO"' });
  await guest.wait(c => c.state.title === 'Inloggning; med "SSO"');
  host.send({ type: 'vote', value: '8' });
  guest.send({ type: 'vote', value: '5' });
  await host.wait(c => c.state.members.every(p => p.voted));
  await guest.wait(c => c.state.myVote === '5');
  assert.equal(host.state.myVote, '8');
  assert.ok(host.state.members.every(p => p.vote === null));
  assert.ok(guest.state.members.every(p => p.vote === null));
  guest.send({ type: 'reveal' });
  await guest.wait(c => c.errors.length === 1);
  assert.match(guest.errors[0].message, /facilitatorn/);
  assert.equal(guest.state.revealed, false);
  const denied = await fetch(`${base}/api/rooms/${hostIdentity.roomId}/export`, { headers: { Authorization: `Bearer ${joined.body.token}` } });
  assert.equal(denied.status, 403);
  guest.socket.close();
  await host.wait(c => c.state.members.some(p => p.name === 'Alex' && !p.online));
  const reconnected = await connect(joined.body);
  assert.equal(reconnected.state.myVote, '5');
  assert.equal(reconnected.state.members.length, 2);
  host.send({ type: 'reveal' });
  await reconnected.wait(c => c.state.revealed);
  assert.deepEqual(reconnected.state.members.map(p => p.vote), ['8', '5']);
  reconnected.send({ type: 'vote', value: '13' });
  await reconnected.wait(c => c.errors.length > 0);
  assert.match(reconnected.errors[0].message, /redan visade/);
  host.send({ type: 'save', value: '8' });
  await host.wait(c => c.state.history.length === 1 && !c.state.saving);
  assert.equal(host.state.history[0].estimate, '8');
  assert.equal(host.state.title, ''); assert.equal(host.state.revealed, false);
  assert.ok(host.state.members.every(p => !p.voted));
  const content = await store.readSession();
  assert.match(content, /"Inloggning; med ""SSO""";"8"/);
  assert.ok(!content.includes('Joakim')); assert.ok(!content.includes('Alex'));
  const response = await fetch(`${base}/api/rooms/${hostIdentity.roomId}/export`, { headers: { Authorization: `Bearer ${hostIdentity.token}` } });
  assert.equal(response.status, 200); assert.match(response.headers.get('content-type'), /text\/csv/);
  // fetch strips the UTF-8 BOM, while readSession preserves it.
  assert.equal(await response.text(), content.replace(/^\uFEFF/, ''));
});

test('rooms stay isolated, title changes reset votes, reset clears revealed cards, explicit leave removes guests', async t => {
  const { post, connect } = await setup(t);
  const a = (await post('/api/rooms', { name: 'A' })).body;
  const b = (await post('/api/rooms', { name: 'B' })).body;
  const hostA = await connect(a); const hostB = await connect(b);
  const visitor = (await post(`/api/rooms/${a.roomId}/join`, { name: 'Visitor' })).body;
  const guest = await connect(visitor);
  hostA.send({ type: 'vote', value: '?' });
  await guest.wait(c => c.state.members.some(p => p.voted));
  assert.equal(hostB.state.members.length, 1); assert.equal(hostB.state.members[0].voted, false);
  hostA.send({ type: 'title', value: 'Ny uppgift' });
  await guest.wait(c => c.state.title === 'Ny uppgift');
  assert.ok(guest.state.members.every(p => !p.voted));
  guest.send({ type: 'vote', value: '☕' });
  await hostA.wait(c => c.state.members.some(p => p.voted));
  hostA.send({ type: 'reveal' });
  await guest.wait(c => c.state.revealed);
  hostA.send({ type: 'reset' });
  await guest.wait(c => !c.state.revealed);
  assert.ok(guest.state.members.every(p => p.vote === null && !p.voted));
  guest.send({ type: 'leave' });
  await hostA.wait(c => c.state.members.length === 1);
  const invalid = await connect(visitor);
  assert.ok(invalid.errors[0].fatal);
});

test('invalid input and cross-origin mutations are rejected', async t => {
  const { base, post, connect } = await setup(t);
  assert.equal((await post('/api/rooms', { name: '   ' })).status, 400);
  assert.equal((await post('/api/rooms', { name: 'A'.repeat(41) })).status, 400);
  assert.equal((await post('/api/rooms/missing/join', { name: 'A' })).status, 400);
  assert.equal((await post('/api/rooms', { name: 'A' }, { Origin: 'https://other.example' })).status, 403);
  const identity = (await post('/api/rooms', { name: 'Host' })).body;
  const host = await connect(identity);
  host.send({ type: 'vote', value: '100000' });
  await host.wait(c => c.errors.length > 0);
  assert.equal(host.state.myVote, null);
  const exportNoAuth = await fetch(`${base}/api/rooms/${identity.roomId}/export`);
  assert.equal(exportNoAuth.status, 400);
  const invalid = await connect({ roomId: identity.roomId, token: 'wrong' });
  assert.equal(invalid.errors[0].fatal, true);
});

test('failed disk write keeps the current task and revealed votes', async () => {
  const directory = await mkdtemp(path.join(tmpdir(), 'planning-poker-write-failure-'));
  const store = await createStore(directory);
  const { room, person } = store.create('Host');
  // Simulate a real I/O failure using a closed file descriptor.
  await store.act(room, person, { type: 'title', value: 'Behåll mig' });
  await store.act(room, person, { type: 'vote', value: '5' });
  person.sockets.add({ readyState: 0 });
  await store.act(room, person, { type: 'reveal' });
  await store.close();
  try {
    await assert.rejects(store.act(room, person, { type: 'save', value: '5' }), /Kunde inte spara filen/);
    assert.equal(room.title, 'Behåll mig'); assert.equal(room.revealed, true); assert.equal(person.vote, '5');
    assert.equal(room.history.length, 0); assert.equal(room.saving, false);
  } finally { await rm(directory, { recursive: true, force: true }); }
});

test('CSV escapes quotes, newlines and spreadsheet formulas', () => {
  assert.equal(csvCell('normal; text'), '"normal; text"');
  assert.equal(csvCell('a"b\nc'), '"a""b\nc"');
  assert.equal(csvCell('=HYPERLINK("bad")'), '"\'=HYPERLINK(""bad"")"');
  assert.equal(csvCell('  @SUM(1)'), '"\'  @SUM(1)"');
});
