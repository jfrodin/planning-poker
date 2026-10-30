import { spawn, execFileSync } from 'node:child_process';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import assert from 'node:assert/strict';
import { WebSocket } from 'ws';

if (process.platform !== 'win32') throw new Error('Pakettestet ska köras på Windows, till exempel av GitHub Actions.');
const pkg = JSON.parse(await readFile('package.json', 'utf8'));
const zip = path.resolve('outputs', `planning-poker-windows-x64-${pkg.version}.zip`);
const directory = await mkdtemp(path.join(tmpdir(), 'planning-poker-release-'));
let child, socket, output = '';
function run(command, args, options = {}) {
  return new Promise((resolve, reject) => {
    const process = spawn(command, args, { stdio: 'inherit', ...options });
    process.on('error', reject);
    process.on('exit', code => code === 0 ? resolve() : reject(new Error(`${command}: ${code}`)));
  });
}
try {
  await run('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command',
    'Add-Type -AssemblyName System.IO.Compression.FileSystem; [System.IO.Compression.ZipFile]::ExtractToDirectory($env:POKER_TEST_ZIP, $env:POKER_TEST_DIRECTORY)'],
    { env: { ...process.env, POKER_TEST_ZIP: zip, POKER_TEST_DIRECTORY: directory } });
  const app = path.join(directory, 'Planning Poker');
  assert.equal(existsSync(path.join(app, 'sessions')), false, 'Paketet får inte innehålla sessionsfiler.');
  for (const filename of ['node.exe', 'cloudflared.exe']) {
    const version = execFileSync(path.join(app, '.runtime', filename), ['--version'], { encoding: 'utf8' });
    console.log(`${filename}: ${version.trim()}`);
  }
  assert.equal(JSON.parse(await readFile(path.join(app, 'BUNDLE-INFO.json'))).version, pkg.version);
  child = spawn('cmd.exe', ['/d', '/s', '/c', 'Starta-lokalt.cmd'], {
    cwd: app, windowsHide: true,
    env: { ...process.env, POKER_NO_OPEN: '1' }, stdio: ['ignore', 'pipe', 'pipe'],
  });
  let launchError;
  child.on('error', error => { launchError = error; });
  child.stdout.on('data', data => { output += data; });
  child.stderr.on('data', data => { output += data; });
  let base;
  for (let attempt = 0; attempt < 60; attempt++) {
    if (launchError) throw launchError;
    if (child.exitCode !== null) throw new Error('Startfilen avslutades innan appen var klar.');
    const address = output.match(/http:\/\/localhost:\d+/)?.[0];
    if (address) {
      try {
        const response = await fetch(`${address}/api/health`, { signal: AbortSignal.timeout(1500) });
        const health = await response.json();
        if (response.ok && health.app === 'planning-poker') { base = address; break; }
      } catch { /* The bundled server is still starting. */ }
    }
    await new Promise(resolve => setTimeout(resolve, 500));
  }
  assert.ok(base, 'Appen startade inte från den uppackade ZIP-filen.');
  const page = await fetch(base); assert.equal(page.status, 200); await page.text();
  async function create(route, name) {
    const response = await fetch(base + route, { method: 'POST', headers: { 'Content-Type': 'application/json', Origin: base }, body: JSON.stringify({ name }) });
    assert.ok(response.ok); assert.match(response.headers.get('content-type'), /application\/json/);
    const result = await response.json(); assert.equal(typeof result.token, 'string'); return result;
  }
  const host = await create('/api/rooms', 'Pakettest');
  const guest = await create(`/api/rooms/${host.roomId}/join`, 'Deltagare');
  socket = new WebSocket(base.replace('http:', 'ws:') + '/socket', { origin: base });
  await new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('WebSocket startade inte.')), 5000);
    socket.once('open', () => socket.send(JSON.stringify({ type: 'connect', ...guest })));
    socket.once('message', data => {
      clearTimeout(timer);
      try { const result = JSON.parse(data); assert.equal(result.type, 'state'); assert.equal(result.state.members.length, 2); resolve(); }
      catch (error) { reject(error); }
    });
    socket.once('error', error => { clearTimeout(timer); reject(error); });
  });
  console.log('Windows-paket OK: uppackning, medföljande program, Starta-lokalt.cmd, skapa rum, anslutning och WebSocket.');
} catch (error) {
  console.error(output); throw error;
} finally {
  socket?.terminate();
  if (child?.pid) {
    try { await run('taskkill.exe', ['/pid', String(child.pid), '/t', '/f']); } catch { /* It may already have exited. */ }
  }
  await rm(directory, { recursive: true, force: true, maxRetries: 5, retryDelay: 300 });
}
