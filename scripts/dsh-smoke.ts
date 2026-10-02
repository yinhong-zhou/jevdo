import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { spawn } from 'node:child_process';
import { ROOT } from '../src/config.ts';
import { makeFixture } from './fixtures.ts';

const root = join(ROOT, '.runtime', `dsh-cli-${Date.now()}`);
await mkdir(root, { recursive: true });
const store = await makeFixture(root, ['alpha']);
const patch = join(root, 'smoke.patch.yml');
await writeFile(patch, JSON.stringify([{ id: 'jevaction-loop', config: { home: store.home, agents: [] } }], null, 2));
const launcher = join(root, 'launch.ps1');
const quote = (s: string) => "'" + s.replaceAll("'", "''") + "'";
await writeFile(launcher, `& npm exec --yes --package=@deepseek-ai/dsh@0.2.0-rc.1 -- dsh --profile jevaction-smoke --patch ${quote(patch)} --json ${quote('build_artifact alpha')}\nexit $LASTEXITCODE\n`);
const result = await new Promise<{ code: number | null; stdout: string; stderr: string }>((resolve, reject) => {
  const child = spawn('pwsh.exe', ['-NoLogo', '-NoProfile', '-File', launcher], {
    cwd: join(root, 'alpha'), windowsHide: true,
    env: { ...process.env, DSH_HOME: join(ROOT, '.runtime', 'dsh-home') },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  let stdout = '', stderr = '';
  child.stdout.on('data', d => { stdout += d.toString(); });
  child.stderr.on('data', d => { stderr += d.toString(); });
  const timeout = setTimeout(() => child.kill(), 120000);
  child.on('error', error => { clearTimeout(timeout); reject(error); });
  child.on('close', code => { clearTimeout(timeout); resolve({ code, stdout, stderr }); });
});
const artifact = await readFile(join(root, 'alpha', 'artifact.txt'), 'utf8');
const success = result.code === 0 && artifact === 'alpha:2';
await mkdir(join(ROOT, 'reports'), { recursive: true });
await writeFile(join(ROOT, 'reports', 'dsh-cli-smoke.json'), JSON.stringify({ version: '0.2.0-rc.1', root, success, artifact, ...result }, null, 2));
console.log(JSON.stringify({ root, success, artifact, ...result }, null, 2));
if (!success) process.exitCode = 1;
