import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import path from 'node:path';
const localNode = path.resolve('.runtime/node_modules/node/bin/node');
const executable = Number(process.versions.node.split('.')[0]) >= 22 ? process.execPath : existsSync(localNode) ? localNode : null;
if (!executable) { console.error('Planning Poker behöver Node.js 22 eller senare. Installera Node 22 och kör npm install igen.'); process.exit(1); }
const commands = {
  dev: ['server/start.mjs', '--dev'],
  start: ['server/start.mjs'],
  build: ['node_modules/vinext/dist/cli.js', 'build'],
  test: ['--test', 'tests/poker.test.mjs', 'tests/api-response.test.mjs'],
  check: ['node_modules/typescript/bin/tsc', '--noEmit'],
  package: ['scripts/package.mjs'],
  'test-production': ['--test', 'tests/production.test.mjs'],
  'test-package': ['scripts/verify-package.mjs'],
};
// A running production process retains its module graph. Rebuilding its files
// would make the HTML reference JavaScript chunks that no longer exist.
if (process.argv[2] === 'build') {
  let status;
  try {
    const response = await fetch(`http://127.0.0.1:${process.env.PORT || 3000}/api/health`, { signal: AbortSignal.timeout(1000) });
    status = await response.json();
  } catch { /* No app is running on the configured port. */ }
  if (status?.mode === 'production') {
    console.error('Stoppa produktionsservern innan du bygger om appen. Starta den igen efter bygget.');
    process.exit(1);
  }
}
const args = commands[process.argv[2]];
if (!args) throw new Error('Okänt kommando.');
const child = spawn(executable, [...args, ...process.argv.slice(3)], { stdio: 'inherit', env: { ...process.env, PATH: `${path.dirname(executable)}${path.delimiter}${process.env.PATH}` } });
child.on('exit', (code, signal) => { if (signal) process.kill(process.pid, signal); else process.exit(code || 0); });
child.on('error', error => { console.error(error.message); process.exit(1); });
for (const signal of ['SIGINT','SIGTERM']) process.on(signal, () => child.kill(signal));
