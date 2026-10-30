import { spawn } from 'node:child_process';
import { cp, mkdir, readFile, writeFile, rm, chmod } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const root = fileURLToPath(new URL('..', import.meta.url));
process.chdir(root);
function option(name, fallback) { const index = process.argv.indexOf(name); return index < 0 ? fallback : process.argv[index + 1]; }
const platform = option('--platform', process.platform);
const arch = option('--arch', process.arch);
if (!(platform === 'win32' && arch === 'x64') && !(platform === 'darwin' && platform === process.platform && arch === process.arch)) throw new Error('Stöd: Windows x64, eller Mac med samma processor som byggdatorn.');
if (!existsSync('dist/server/index.js')) throw new Error('Kör npm run build först.');
const pkg = JSON.parse(await readFile('package.json', 'utf8'));
const staging = path.resolve('work/packages', `${platform}-${arch}`);
const app = path.join(staging, 'Planning Poker');
const runtime = path.join(app, '.runtime');
const output = path.resolve('outputs');
const zip = path.join(output, `planning-poker-${platform === 'win32' ? 'windows' : 'mac'}-${arch}-${pkg.version}.zip`);

async function run(command, args, options = {}) {
  await new Promise((resolve, reject) => {
    const child = spawn(command, args, { stdio: 'inherit', ...options });
    child.on('error', reject);
    child.on('exit', code => code === 0 ? resolve() : reject(new Error(`${command} avslutades med kod ${code}`)));
  });
}
async function fetchBytes(url) {
  const response = await fetch(url, { headers: { 'User-Agent': 'team-planning-poker' }, signal: AbortSignal.timeout(120000) });
  if (!response.ok) throw new Error(`Kunde inte hämta ${url}: HTTP ${response.status}`);
  return Buffer.from(await response.arrayBuffer());
}
async function verifiedDownload(url, expected, destination) {
  const bytes = await fetchBytes(url);
  const actual = createHash('sha256').update(bytes).digest('hex');
  if (actual !== expected) throw new Error(`Fel SHA-256 för ${url}`);
  await writeFile(destination, bytes);
}

await rm(staging, { recursive: true, force: true });
await mkdir(runtime, { recursive: true });
await mkdir(path.join(app, 'licenses'), { recursive: true });
await mkdir(output, { recursive: true });
for (const directory of ['server', 'public']) {
  if (existsSync(directory)) await cp(directory, path.join(app, directory), { recursive: true });
}
await cp('dist', path.join(app, 'dist'), { recursive: true, filter: source => path.basename(source) !== '.openai' });
await mkdir(path.join(app, 'scripts'));
for (const filename of ['share.mjs', 'launch.mjs']) await cp(path.join('scripts', filename), path.join(app, 'scripts', filename));
for (const filename of ['package.json', 'package-lock.json']) await cp(filename, path.join(app, filename));
await writeFile(path.join(app, 'LAS-MIG.txt'), (await readFile('packaging/LAS-MIG.txt', 'utf8')).replaceAll('{{VERSION}}', pkg.version));

console.log(`Förbereder ${platform} ${arch}…`);
if (platform === process.platform && arch === process.arch) {
  await cp('node_modules', path.join(app, 'node_modules'), { recursive: true });
  const nodeFilename = platform === 'win32' ? 'node.exe' : 'node';
  await cp(process.execPath, path.join(runtime, nodeFilename));
  if (platform !== 'win32') await chmod(path.join(runtime, nodeFilename), 0o755);
} else {
  // Install the optional native libraries for the recipient's OS, never the build computer's.
  const npmArgs = ['ci', '--prefix', app, '--ignore-scripts', '--no-audit', '--no-fund', `--os=${platform}`, `--cpu=${arch}`, '--cache', path.resolve('.runtime/npm-cache')];
  if (process.env.npm_execpath) await run(process.execPath, [process.env.npm_execpath, ...npmArgs]);
  else await run('npm', npmArgs);
  const artifact = `win-${arch}/node.exe`;
  const base = `https://nodejs.org/dist/${process.version}`;
  const sums = (await fetchBytes(`${base}/SHASUMS256.txt`)).toString();
  const checksum = sums.split('\n').map(line => line.trim().split(/\s+/)).find(parts => parts[1] === artifact)?.[0];
  if (!checksum) throw new Error(`Node-versionen ${process.version} saknar ${artifact}.`);
  await verifiedDownload(`${base}/${artifact}`, checksum, path.join(runtime, 'node.exe'));
}
await writeFile(path.join(app, 'licenses/Node-LICENSE.txt'), await fetchBytes(`https://raw.githubusercontent.com/nodejs/node/${process.version}/LICENSE`));

const release = JSON.parse((await fetchBytes('https://api.github.com/repos/cloudflare/cloudflared/releases/latest')).toString());
const assetName = platform === 'win32' ? 'cloudflared-windows-amd64.exe' : `cloudflared-darwin-${arch === 'arm64' ? 'arm64' : 'amd64'}.tgz`;
const asset = release.assets.find(candidate => candidate.name === assetName);
if (!asset?.digest?.startsWith('sha256:')) throw new Error('Cloudflare-releasen saknar kontrollsumma.');
if (platform === 'win32') {
  await verifiedDownload(asset.browser_download_url, asset.digest.slice(7), path.join(runtime, 'cloudflared.exe'));
} else {
  const archive = path.join(staging, 'cloudflared.tgz');
  await verifiedDownload(asset.browser_download_url, asset.digest.slice(7), archive);
  await run('tar', ['-xzf', archive, '-C', runtime, 'cloudflared']);
  await chmod(path.join(runtime, 'cloudflared'), 0o755);
}
await writeFile(path.join(app, 'licenses/cloudflared-LICENSE.txt'), await fetchBytes(`https://raw.githubusercontent.com/cloudflare/cloudflared/${release.tag_name}/LICENSE`));
const extension = platform === 'win32' ? 'cmd' : 'command';
for (const name of ['Starta', 'Starta-lokalt']) {
  const filename = `${name}.${extension}`;
  let content = await readFile(path.join('packaging', filename), 'utf8');
  if (platform === 'win32') content = content.replace(/\r?\n/g, '\r\n');
  await writeFile(path.join(app, filename), content, { mode: 0o755 });
}
await writeFile(path.join(app, 'BUNDLE-INFO.json'), JSON.stringify({ name: pkg.name, version: pkg.version, platform, arch, node: process.version, cloudflared: release.tag_name, builtAt: new Date().toISOString() }, null, 2) + '\n');
console.log('Skapar ZIP…');
await rm(zip, { force: true });
if (process.platform === 'darwin') await run('ditto', ['-c', '-k', '--keepParent', '--norsrc', app, zip]);
else if (process.platform === 'win32') {
  // .NET includes dot-directories such as .runtime; Compress-Archive may omit hidden files.
  await run('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command',
    'Add-Type -AssemblyName System.IO.Compression.FileSystem; [System.IO.Compression.ZipFile]::CreateFromDirectory($env:POKER_ZIP_SOURCE, $env:POKER_ZIP_TARGET, [System.IO.Compression.CompressionLevel]::Optimal, $false)'],
    { env: { ...process.env, POKER_ZIP_SOURCE: staging, POKER_ZIP_TARGET: zip } });
}
else await run('zip', ['-q', '-r', zip, 'Planning Poker'], { cwd: staging });
console.log(`\nPaket klart: ${zip}\n`);
