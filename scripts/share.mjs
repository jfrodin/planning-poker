import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { mkdir, writeFile, chmod, rename, rm } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import path from 'node:path';

const port = Number(process.env.PORT || 3000);
const target = `http://127.0.0.1:${port}`;
const runtime = path.resolve('.runtime');
let app, tunnel, stopping = false;
function stop(code = 0) {
  if (stopping) return; stopping = true;
  tunnel?.kill('SIGTERM'); app?.kill('SIGTERM'); process.exitCode = code;
}
for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, () => stop());
async function health() {
  try { const response = await fetch(`${target}/api/health`, { signal: AbortSignal.timeout(1500) }); if (!response.ok || !response.headers.get("content-type")?.includes("application/json")) return null; const status = await response.json(); return status.ok === true && status.app === "planning-poker" ? status : null; } catch { return null; }
}
async function binary() {
  if (process.env.CLOUDFLARED_BIN) return process.env.CLOUDFLARED_BIN;
  const executable = path.join(runtime, process.platform === 'win32' ? 'cloudflared.exe' : 'cloudflared');
  if (existsSync(executable)) return executable;
  const architecture = { x64: 'amd64', arm64: 'arm64' }[process.arch];
  const assetName = process.platform === 'darwin' ? `cloudflared-darwin-${architecture}.tgz` : process.platform === 'linux' ? `cloudflared-linux-${architecture}` : process.platform === 'win32' ? `cloudflared-windows-${architecture}.exe` : null;
  if (!assetName || !architecture) throw new Error('Installera cloudflared och ange sökvägen med CLOUDFLARED_BIN.');
  console.log('Hämtar cloudflared från Cloudflares officiella GitHub-release (första gången)…');
  const release = await fetch('https://api.github.com/repos/cloudflare/cloudflared/releases/latest', { headers: { 'User-Agent': 'team-planning-poker' } });
  if (!release.ok) throw new Error('Kunde inte hämta cloudflared. Kontrollera nätverket eller använd CLOUDFLARED_BIN.');
  const asset = (await release.json()).assets.find(item => item.name === assetName);
  if (!asset) throw new Error('Ingen cloudflared-version finns för denna dator.');
  const response = await fetch(asset.browser_download_url);
  if (!response.ok) throw new Error('Kunde inte hämta tunnelprogrammet.');
  const bytes = Buffer.from(await response.arrayBuffer());
  if (!asset.digest?.startsWith('sha256:')) throw new Error('Releasen saknar SHA-256-kontrollsumma. Installera cloudflared manuellt.');
  if (`sha256:${createHash('sha256').update(bytes).digest('hex')}` !== asset.digest) throw new Error('Kontrollsumman för cloudflared stämmer inte.');
  await mkdir(runtime, { recursive: true });
  const temporary = path.join(runtime, `cloudflared-download-${process.pid}`);
  await mkdir(temporary);
  try {
    if (process.platform === 'darwin') {
      const archive = path.join(temporary, 'cloudflared.tgz'); await writeFile(archive, bytes);
      await new Promise((resolve, reject) => { const tar = spawn('tar', ['-xzf', archive, '-C', temporary, 'cloudflared'], { stdio: 'inherit' }); tar.on('exit', code => code === 0 ? resolve() : reject(new Error('Kunde inte packa upp cloudflared.'))); tar.on('error', reject); });
      await rename(path.join(temporary, 'cloudflared'), executable);
    } else { await writeFile(path.join(temporary, 'binary'), bytes); await rename(path.join(temporary, 'binary'), executable); }
    await chmod(executable, 0o755);
  } finally { await rm(temporary, { recursive: true, force: true }); }
  return executable;
}
try {
  const cloudflared = await binary();
  if (stopping) process.exit(0);
  let status = await health();
  if (status && status.mode !== 'production') throw new Error('Utvecklingsservern kör redan. Stoppa npm run dev innan du kör npm run share.');
  if (!status) {
    if (!existsSync('dist/server')) throw new Error('Bygg först appen med npm run build och kör sedan npm run share igen.');
    const localNode = path.join(runtime, 'node_modules/node/bin/node');
    const node = Number(process.versions.node.split('.')[0]) >= 22 ? process.execPath : existsSync(localNode) ? localNode : null;
    if (!node) throw new Error('Node.js 22 eller senare krävs.');
    app = spawn(node, ['server/start.mjs'], { stdio: 'inherit', env: process.env });
    app.on('error', error => { console.error(error.message); stop(1); });
    app.on('exit', code => { if (!stopping) stop(code || 1); });
    for (let attempts = 0; attempts < 30 && !status && !stopping; attempts++) {
      await new Promise(resolve => setTimeout(resolve, 500)); status = await health();
    }
    if (!status) throw new Error('Appen kunde inte starta.');
  }
  console.log('\nSkapar en publik HTTPS-länk. Låt detta fönster vara öppet under mötet.\n');
  tunnel = spawn(cloudflared, ['tunnel', '--no-autoupdate', '--url', target], { stdio: ['ignore', 'pipe', 'pipe'] });
  let output = '', shared = false;
  const showOutput = chunk => {
    const text = chunk.toString(); output = (output + text).slice(-12000);
    const match = output.match(/https:\/\/[a-z0-9-]+\.trycloudflare\.com/);
    if (match && !shared) { shared = true; console.log(`\n  Öppna: ${match[0]}\n  Skapa ett rum och dela sedan rumslänken med teamet.\n  Ctrl+C avslutar tunneln.\n`); }
  };
  tunnel.stdout.on('data', showOutput); tunnel.stderr.on('data', showOutput);
  tunnel.on('error', error => { console.error(error.message); stop(1); });
  tunnel.on('exit', code => { if (!stopping) { console.error('Tunneln har avslutats.\n' + output); stop(code || 1); } });
} catch (error) { console.error(error.message); stop(1); }
