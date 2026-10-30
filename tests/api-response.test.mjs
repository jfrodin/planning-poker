import test from 'node:test';
import assert from 'node:assert/strict';
import { readApiResponse, isRoomIdentity } from '../lib/api-response.mjs';

test('an HTML response from the frontend explains the wrong address instead of leaking a JSON syntax error', async () => {
  const response = new Response('<!DOCTYPE html><html>Not found</html>', { status: 404, headers: { 'Content-Type': 'text/html' } });
  await assert.rejects(readApiResponse(response), /adressen saknar appens server/);
});
test('a tunnel error page explains that the server is unavailable', async () => {
  const response = new Response('<!DOCTYPE html><html>Bad gateway</html>', { status: 502, headers: { 'Content-Type': 'text/html' } });
  await assert.rejects(readApiResponse(response), /Servern är inte tillgänglig/);
});
test('valid room responses are decoded and validated before reconnect credentials are stored', async () => {
  const identity = { roomId: 'room-id-12345678901234', token: 'private-token-1234567890' };
  const result = await readApiResponse(Response.json(identity, { status: 201 }));
  assert.deepEqual(result, identity); assert.equal(isRoomIdentity(result), true);
  for (const invalid of [null, [], {}, { ok: true }, { roomId: 'x', token: 123 }, { roomId: identity.roomId, token: '' }]) assert.equal(isRoomIdentity(invalid), false);
});
test('JSON errors keep the server explanation, and corrupt JSON receives a readable error', async () => {
  await assert.rejects(readApiResponse(Response.json({ error: 'Rummet finns inte längre.' }, { status: 400 })), /Rummet finns inte längre/);
  await assert.rejects(readApiResponse(new Response('{', { headers: { 'Content-Type': 'application/json' } })), /Servern skickade ett ogiltigt svar/);
});
