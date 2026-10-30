import net from 'node:net';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

// Resolve the application relative to this script, even when launched by double-click.
process.chdir(fileURLToPath(new URL('..', import.meta.url)));
const local = process.argv.includes('--local');
const reservations = [];
async function reservePort() {
  const server = net.createServer();
  await new Promise((resolve, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', resolve); });
  reservations.push(server);
  return server.address().port;
}
const port = await reservePort();
await Promise.all(reservations.map(server => new Promise(resolve => server.close(resolve))));
const env = { ...process.env, PORT: String(port), HOST: '127.0.0.1' };
console.log(local ? '\nStartar Planning Poker lokalt…' : '\nStartar Planning Poker med en publik Cloudflare-länk…');
console.log('Låt detta fönster vara öppet under mötet. Ctrl+C avslutar sessionen.\n');
const child = spawn(process.execPath, [local ? 'server/start.mjs' : 'scripts/share.mjs'], { env, stdio: ['inherit', 'pipe', 'pipe'] });
let opened = false, stopping = false, output = '';
async function openWhenReady(url) {
  for (let attempt = 0; attempt < 30 && !stopping; attempt++) {
    try {
      const response = await fetch(url, { signal: AbortSignal.timeout(2000) });
      if (response.ok) {
        await response.body?.cancel();
        if (process.env.POKER_NO_OPEN !== '1' && !stopping) {
          const command = process.platform === 'win32' ? ['cmd.exe', ['/d', '/c', 'start', '""', url]] : process.platform === 'darwin' ? ['open', [url]] : ['xdg-open', [url]];
          const browser = spawn(command[0], command[1], { stdio: 'ignore', windowsHide: true });
          browser.on('error', () => console.log(`Öppna länken i din webbläsare: ${url}`));
          browser.unref();
        }
        return;
      }
      await response.body?.cancel();
    } catch { /* The local renderer or tunnel may take a moment to become ready. */ }
    await new Promise(resolve => setTimeout(resolve, 1000));
  }
  if (!stopping) console.log(`Öppna länken i din webbläsare: ${url}`);
}
function onOutput(chunk) {
  process.stdout.write(chunk);
  output = (output + chunk.toString()).slice(-12000);
  if (!opened) {
    const url = local ? `http://localhost:${port}` : output.match(/https:\/\/[a-z0-9-]+\.trycloudflare\.com/)?.[0];
    if (url) { opened = true; void openWhenReady(url); }
  }
}
child.stdout.on('data', onOutput); child.stderr.on('data', onOutput);
child.on('error', error => { console.error(error.message); process.exitCode = 1; });
child.on('exit', code => { stopping = true; process.exitCode = code || 0; });
for (const signal of ['SIGINT', 'SIGTERM', 'SIGHUP']) process.on(signal, () => { stopping = true; child.kill('SIGTERM'); });
