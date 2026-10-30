import path from 'node:path';
import { startProdServer } from 'vinext/server/prod-server';
import { attachApi } from './api.mjs';

// Serve the page, API and WebSocket on one port. A separate frontend address
// lets users load the form while accidentally bypassing the room API.
export async function createProductionServer(store, { port = 3000, host = '127.0.0.1', outDir = path.resolve('dist') } = {}) {
  const { server } = await startProdServer({ port, host, outDir, silent: true });
  const renderers = server.listeners('request');
  if (renderers.length !== 1) {
    await new Promise(resolve => server.close(resolve));
    throw new Error('Kunde inte ansluta gränssnittet till appservern.');
  }
  const [render] = renderers;
  const api = attachApi(server, store);
  server.removeListener('request', render);
  server.on('request', async (req, res) => {
    try {
      if (!await api.handle(req, res)) render.call(server, req, res);
    } catch (error) {
      console.error('Request failed:', error);
      if (!res.headersSent) res.writeHead(500, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
      if (!res.writableEnded) res.end(JSON.stringify({ error: 'Servern kunde inte behandla förfrågan. Försök igen.' }));
    }
  });
  server.on('upgrade', (req, socket, head) => { if (!api.upgrade(req, socket, head)) socket.destroy(); });
  return { server, api };
}
