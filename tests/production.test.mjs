import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { WebSocket } from 'ws';
import { createStore } from '../server/rooms.mjs';

process.env.NODE_ENV = 'production';
const { createProductionServer } = await import('../server/production.mjs');

test('the production page, create/join API and WebSocket all work on the same address', async t => {
  const directory = await mkdtemp(path.join(tmpdir(), 'poker-production-'));
  const store = await createStore(directory);
  const { server, api } = await createProductionServer(store, { port: 0 });
  const base = `http://127.0.0.1:${server.address().port}`;
  t.after(async () => { api.close(); server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); await store.close(); await rm(directory, { recursive: true, force: true }); });
  const page = await fetch(base);
  assert.equal(page.status, 200); assert.match(page.headers.get('content-type'), /text\/html/);
  const html = await page.text();
  for (const [, src] of html.matchAll(/<script[^>]*\bsrc="([^"]+)"/g)) {
    const asset = await fetch(new URL(src, base));
    assert.equal(asset.status, 200); assert.match(asset.headers.get('content-type'), /javascript/); await asset.arrayBuffer();
  }
  const health = await (await fetch(base + '/api/health')).json();
  assert.equal(health.app, 'planning-poker');
  async function post(route, name) {
    const response = await fetch(base + route, { method: 'POST', headers: { 'Content-Type': 'application/json', Origin: base }, body: JSON.stringify({ name }) });
    assert.ok(response.ok); assert.match(response.headers.get('content-type'), /application\/json/);
    const identity = await response.json(); assert.equal(typeof identity.token, 'string'); return identity;
  }
  const host = await post('/api/rooms', 'Host');
  const guest = await post(`/api/rooms/${host.roomId}/join`, 'Guest');
  const socket = new WebSocket(base.replace('http:', 'ws:') + '/socket', { origin: base });
  await new Promise((resolve, reject) => {
    const timer = setTimeout(() => { socket.terminate(); reject(new Error('WebSocket timeout')); }, 3000);
    socket.once('open', () => socket.send(JSON.stringify({ type: 'connect', ...guest })));
    socket.once('message', data => {
      try { const message = JSON.parse(data); assert.equal(message.type, 'state'); assert.equal(message.state.members.length, 2); clearTimeout(timer); socket.close(); resolve(); }
      catch (error) { clearTimeout(timer); socket.terminate(); reject(error); }
    });
    socket.once('error', error => { clearTimeout(timer); reject(error); });
  });
  const unknownApi = await fetch(base + '/api/does-not-exist');
  assert.equal(unknownApi.status, 404); assert.match(unknownApi.headers.get('content-type'), /application\/json/); await unknownApi.body?.cancel();
});
