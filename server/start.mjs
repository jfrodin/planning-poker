import http from 'node:http';
import { spawn } from 'node:child_process';
import path from 'node:path';
import httpProxy from 'http-proxy';
import { createStore } from './rooms.mjs';
import { attachApi } from './api.mjs';

const dev = process.argv.includes('--dev');
const port = Number(process.env.PORT || 3000);
const host = process.env.HOST || '127.0.0.1';
const directory = path.resolve(process.env.DATA_DIR || 'sessions');
const store = await createStore(directory);
let server, api, frontend, proxy;
let stopping = false;

async function stop(code = 0) {
  if (stopping) return; stopping = true;
  frontend?.kill('SIGTERM'); api?.close(); proxy?.close(); server?.close(); server?.closeAllConnections();
  await store.close(); process.exit(code);
}
try {
  if (dev) {
    const frontendPort = Number(process.env.FRONTEND_PORT || 3100);
    if (port === frontendPort) throw new Error('PORT och FRONTEND_PORT måste vara olika vid lokal utveckling.');
    frontend = spawn(process.execPath, ['node_modules/vinext/dist/cli.js', 'dev', '--port', String(frontendPort), '--hostname', '127.0.0.1'], { stdio: ['ignore', 'ignore', 'inherit'], env: { ...process.env, NODE_ENV: 'development' } });
    proxy = httpProxy.createProxyServer({ target: `http://127.0.0.1:${frontendPort}`, ws: true, changeOrigin: true });
    proxy.on('error', (_error, _req, res) => {
      if (typeof res.writeHead === 'function') {
        if (!res.headersSent) res.writeHead(503, { 'Content-Type': 'text/plain; charset=utf-8', 'Retry-After': '2' });
        res.end('Appen startar. Ladda om om ett ögonblick.');
      } else res.destroy();
    });
    server = http.createServer(async (req, res) => { if (!await api.handle(req, res)) proxy.web(req, res); });
    api = attachApi(server, store, { dev });
    server.on('upgrade', (req, socket, head) => { if (!api.upgrade(req, socket, head)) proxy.ws(req, socket, head); });
    frontend.on('exit', code => { if (!stopping) void stop(code || 1); });
    frontend.on('error', error => { console.error(error.message); void stop(1); });
    await new Promise((resolve, reject) => { server.once('error', reject); server.listen(port, host, resolve); });
  } else {
    process.env.NODE_ENV = 'production';
    const { createProductionServer } = await import('./production.mjs');
    ({ server, api } = await createProductionServer(store, { port, host }));
  }
  const actualPort = server.address().port;
  console.log(`\n  Planning Poker → http://localhost:${actualPort}\n  Estimat sparas i ${path.join(directory, store.filename)}\n`);
  server.on('error', error => { console.error(error.message); void stop(1); });
} catch (error) {
  console.error(error.message); await stop(1);
}
process.on('SIGINT', () => void stop()); process.on('SIGTERM', () => void stop());
