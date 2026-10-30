import { WebSocketServer } from 'ws';

function json(res, status, body) {
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' });
  res.end(JSON.stringify(body));
}
async function body(req) {
  if (!req.headers['content-type']?.startsWith('application/json')) throw new Error('JSON krävs.');
  let text = '';
  for await (const chunk of req) { text += chunk; if (text.length > 4096) throw new Error('För stor förfrågan.'); }
  return JSON.parse(text);
}
export function attachApi(server, store, options = {}) {
  const wsServer = new WebSocketServer({ noServer: true, maxPayload: 4096 });
  function sameOrigin(req) {
    if (!req.headers.origin) return true;
    try { return new URL(req.headers.origin).host === req.headers.host; } catch { return false; }
  }
  async function handle(req, res) {
    const url = new URL(req.url, 'http://localhost');
    if (!url.pathname.startsWith('/api/')) return false;
    if (!sameOrigin(req)) { json(res, 403, { error: 'Anslut från appens egen adress.' }); return true; }
    try {
      if (req.method === 'GET' && url.pathname === '/api/health') { json(res, 200, { ok: true, app: "planning-poker", mode: options.dev ? "development" : "production" }); return true; }
      if (req.method === 'POST' && url.pathname === '/api/rooms') {
        const input = await body(req);
        const { room, person } = store.create(input.name);
        json(res, 201, { roomId: room.id, token: person.token }); return true;
      }
      const match = url.pathname.match(/^\/api\/rooms\/([\w-]+)\/(join|export)$/);
      if (match && req.method === 'POST' && match[2] === 'join') {
        const input = await body(req);
        const { room, person } = store.join(match[1], input.name);
        json(res, 200, { roomId: room.id, token: person.token }); return true;
      }
      if (match && req.method === 'GET' && match[2] === 'export') {
        const token = req.headers.authorization?.replace(/^Bearer /, '');
        const { room, person } = store.authenticate(match[1], token);
        if (!person.host) { json(res, 403, { error: 'Bara facilitatorn kan hämta filen.' }); return true; }
        res.writeHead(200, { 'Content-Type': 'text/csv; charset=utf-8', 'Content-Disposition': 'attachment; filename="planning-poker.csv"', 'Cache-Control': 'no-store' });
        res.end(store.exportRoom(room)); return true;
      }
      json(res, 404, { error: 'Adressen finns inte.' });
    } catch (error) { json(res, 400, { error: error.message || 'Något gick fel.' }); }
    return true;
  }
  function upgrade(req, socket, head) {
    if (new URL(req.url, 'http://localhost').pathname !== '/socket') return false;
    if (!sameOrigin(req)) { socket.destroy(); return true; }
    wsServer.handleUpgrade(req, socket, head, ws => wsServer.emit('connection', ws)); return true;
  }
  wsServer.on('connection', socket => {
    let identity;
    let alive = true;
    const authTimeout = setTimeout(() => socket.close(4001, 'Anslut till ett rum.'), 10000);
    socket.on('pong', () => { alive = true; });
    const heartbeat = setInterval(() => { if (!alive) socket.terminate(); else { alive = false; socket.ping(); } }, 30000);
    let lastWindow = Date.now(), count = 0;
    socket.on('message', async data => {
      try {
        if (Date.now() - lastWindow > 1000) { lastWindow = Date.now(); count = 0; }
        if (++count > 30) throw new Error('Lite för många uppdateringar. Vänta ett ögonblick.');
        const message = JSON.parse(data.toString());
        if (!message || typeof message.type !== 'string') throw new Error('Ogiltigt meddelande.');
        if (!identity) {
          if (message.type !== 'connect') throw new Error('Anslut till ett rum först.');
          identity = store.authenticate(message.roomId, message.token);
          identity.person.sockets.add(socket); clearTimeout(authTimeout);
          store.broadcast(identity.room);
        } else if (message.type === 'leave') {
          if (!identity.person.host) {
            const { room, person } = identity;
            room.members.delete(person.id);
            for (const connection of person.sockets) connection.close(4002, 'Du har lämnat rummet.');
            store.broadcast(room);
          } else socket.close(4002, 'Du har lämnat rummet.');
        } else await store.act(identity.room, identity.person, message);
      } catch (error) {
        if (socket.readyState === 1) socket.send(JSON.stringify({ type: 'error', message: error.message, fatal: !identity }));
        if (!identity) socket.close(4001, 'Anslutningen kunde inte återställas.');
      }
    });
    socket.on('error', () => {});
    socket.on('close', () => { clearTimeout(authTimeout); clearInterval(heartbeat); if (identity) { identity.person.sockets.delete(socket); store.broadcast(identity.room); } });
  });
  return { handle, upgrade, close: () => { for (const client of wsServer.clients) client.terminate(); wsServer.close(); } };
}
