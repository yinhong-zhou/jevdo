// A small real developer project: existing scripts, HTTP services and local releases.
// Copied into each isolated benchmark workspace; no Jev/Action code lives here.
import { createServer } from 'node:http';
import { spawn } from 'node:child_process';
import { readFile, writeFile, mkdir, appendFile, open, cp } from 'node:fs/promises';
import { createHash, randomUUID } from 'node:crypto';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
const root = dirname(fileURLToPath(import.meta.url));
const path = file => join(root, file);
const json = async file => JSON.parse(await readFile(path(file), 'utf8'));
const put = async (file, data) => { await mkdir(dirname(path(file)), { recursive: true }); await writeFile(path(file), JSON.stringify(data, null, 2)); };
const log = async (event, details = {}) => { await mkdir(path('.dev'), { recursive: true }); await appendFile(path('.dev/events.jsonl'), JSON.stringify({ time: Date.now(), event, ...details }) + '\n'); };
const wait = ms => new Promise(resolve => setTimeout(resolve, ms));
const hash = value => createHash('sha256').update(value).digest('hex');
async function health(role) {
  try {
    const info = await json(`.dev/${role}.json`);
    const response = await fetch(info.url + '/health', { signal: AbortSignal.timeout(800) });
    if (!response.ok) return null;
    const data = await response.json();
    return data.instance === info.instance && data.project === (await json('project.json')).name ? { ...info, ...data } : null;
  } catch { return null; }
}
async function serve(role, instance) {
  const config = await json('project.json');
  if (role === 'backend' && config.failBackend) { await log('backend-failed'); throw new Error('Backend configuration refuses startup'); }
  if (role === 'frontend' && !await health('backend')) throw new Error('Backend must be ready before frontend starts');
  let stopping = false;
  const server = createServer(async (req, res) => {
    if (req.url === '/health') {
      if (stopping) { res.statusCode = 503; res.end('stopping'); return; }
      res.setHeader('Content-Type', 'application/json');
      res.end(JSON.stringify({ role, instance, project: config.name, pid: process.pid, version: config.version }));
    } else if (req.url === '/shutdown' && req.method === 'POST' && req.headers['x-instance'] === instance) {
      stopping = true;
      res.setHeader('Connection', 'close');
      res.on('finish', () => {
        server.close(() => process.exit(0));
        server.closeAllConnections();
      });
      res.end('stopping');
    } else { res.statusCode = 404; res.end('missing'); }
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const url = `http://127.0.0.1:${server.address().port}`;
  await put(`.dev/${role}.json`, { role, instance, url, pid: process.pid });
  await log(role + '-started', { instance, pid: process.pid });
  // Orphaned benchmark services cannot run indefinitely. The runner also cleans them up.
  setTimeout(() => server.close(() => process.exit(0)), 20 * 60 * 1000);
}
async function start(role) {
  const existing = await health(role);
  if (existing) return { status: 'already-running', ...existing };
  if (role === 'frontend' && !await health('backend')) throw new Error('Backend must be ready before frontend starts');
  const config = await json('project.json');
  if (role === 'backend' && config.failBackend) { await log('backend-failed'); throw new Error('Backend configuration refuses startup'); }
  await mkdir(path('.dev'), { recursive: true });
  const output = await open(path(`.dev/${role}.log`), 'a');
  const child = spawn(process.execPath, [path('dev.mjs'), '_serve', role, randomUUID()], {
    cwd: root, detached: true, windowsHide: true, stdio: ['ignore', output.fd, output.fd],
  });
  let failure;
  child.on('error', error => { failure = error; });
  child.unref(); await output.close();
  for (let n = 0; n < 60; n++) {
    if (failure) throw failure;
    const ready = await health(role); if (ready) return { status: 'started', ...ready };
    await wait(50);
  }
  throw new Error(`Timed out waiting for ${role}`);
}
async function stop(role) {
  const info = await health(role);
  if (!info) return { role, status: 'already-stopped' };
  await fetch(info.url + '/shutdown', { method: 'POST', headers: { 'x-instance': info.instance }, signal: AbortSignal.timeout(1000) });
  for (let n = 0; n < 60; n++) {
    if (!await health(role)) { await log(role + '-stopped', { instance: info.instance }); return { role, status: 'stopped' }; }
    await wait(50);
  }
  throw new Error(`Timed out stopping ${role}`);
}
async function testProject() {
  const source = await readFile(path('src/math.mjs'));
  const module = await import(pathToFileURL(path('src/math.mjs')).href + '?v=' + Date.now());
  if (module.total([2, 3, 7]) !== 12 || module.total([]) !== 0) throw new Error('Unit tests failed');
  await put('.dev/test.json', { sourceHash: hash(source), passed: true });
  await log('tests-passed', { sourceHash: hash(source) }); return { tests: 2, passed: true };
}
async function buildProject() {
  const source = await readFile(path('src/math.mjs'));
  const config = await json('project.json');
  await mkdir(path('build'), { recursive: true }); await cp(path('src/math.mjs'), path('build/math.mjs'));
  await put('build/manifest.json', { version: config.version, sourceHash: hash(source) });
  await log('build-complete'); return json('build/manifest.json');
}
async function verifyBuild() {
  const manifest = await json('build/manifest.json');
  if (manifest.sourceHash !== hash(await readFile(path('src/math.mjs'))) || manifest.sourceHash !== hash(await readFile(path('build/math.mjs')))) throw new Error('Build is missing or stale');
  return manifest;
}
async function generateClient() {
  const schema = await json('schema.json');
  await mkdir(path('generated'), { recursive: true });
  const text = schema.endpoints.map(endpoint => `export const ${endpoint.name} = ${JSON.stringify(endpoint.path)};`).join('\n') + '\n';
  await writeFile(path('generated/client.ts'), text); await log('client-generated'); return { file: 'generated/client.ts', endpoints: schema.endpoints.length };
}
async function verifyClient() {
  const schema = await json('schema.json');
  const expected = schema.endpoints.map(endpoint => `export const ${endpoint.name} = ${JSON.stringify(endpoint.path)};`).join('\n') + '\n';
  if (await readFile(path('generated/client.ts'), 'utf8') !== expected) throw new Error('Generated client is stale');
  return { client: 'current' };
}
async function publish() {
  const build = await verifyBuild(), tests = await json('.dev/test.json');
  if (!tests.passed || tests.sourceHash !== build.sourceHash) throw new Error('Run tests before publishing');
  const previous = await json('deployment.json').catch(() => ({ current: null }));
  const release = `release-${Date.now()}`;
  await cp(path('build'), path(`releases/${release}`), { recursive: true });
  await put('deployment.json', { current: release, previous: previous.current });
  await log('published', { release }); return { release, target: 'local-releases' };
}
async function rollback() {
  const deployment = await json('deployment.json');
  if (!deployment.previous || !/^release-[a-zA-Z0-9-]+$/.test(deployment.previous)) throw new Error('No valid previous release');
  await json(`releases/${deployment.previous}/manifest.json`);
  await put('deployment.json', { current: deployment.previous, previous: deployment.current });
  await log('rolled-back'); return json('deployment.json');
}
async function verifyPublished() {
  const deployment = await json('deployment.json');
  if (!/^release-[a-zA-Z0-9-]+$/.test(deployment.current)) throw new Error('Invalid release name');
  const manifest = await json(`releases/${deployment.current}/manifest.json`);
  if (!manifest.sourceHash) throw new Error('Release has no source hash');
  return { deployment, manifest };
}
async function main(command) {
  if (command === 'status') return { backend: await health('backend'), frontend: await health('frontend') };
  if (command === 'start-backend') return start('backend');
  if (command === 'start-frontend') return start('frontend');
  if (command === 'stop-backend') return stop('backend');
  if (command === 'stop-frontend') return stop('frontend');
  if (command === 'restart-backend') { await stop('backend'); return start('backend'); }
  if (command === 'verify-backend' || command === 'verify-frontend') {
    const state = await health(command.slice(7)); if (!state) throw new Error('Service is not healthy'); return state;
  }
  if (command === 'verify-backend-stopped' || command === 'verify-frontend-stopped') {
    const role = command.slice(7, -8); if (await health(role)) throw new Error('Service still running'); return { role, stopped: true };
  }
  if (command === 'test') return testProject();
  if (command === 'verify-tests') {
    const report = await json('.dev/test.json'); if (!report.passed || report.sourceHash !== hash(await readFile(path('src/math.mjs')))) throw new Error('Tests stale'); return report;
  }
  if (command === 'build') return buildProject();
  if (command === 'verify-build') return verifyBuild();
  if (command === 'generate-client') return generateClient();
  if (command === 'verify-client') return verifyClient();
  if (command === 'publish') return publish();
  if (command === 'rollback') return rollback();
  if (command === 'verify-release') return verifyPublished();
  throw new Error('Unknown command ' + command);
}
try {
  if (process.argv[2] === '_serve') await serve(process.argv[3], process.argv[4]);
  else console.log('OK ' + JSON.stringify(await main(process.argv[2])));
} catch (error) { console.error('ERROR ' + error.message); process.exitCode = 1; }
