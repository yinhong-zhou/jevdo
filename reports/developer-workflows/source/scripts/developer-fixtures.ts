import assert from 'node:assert/strict';
import { readFile, writeFile, mkdir, cp, rm } from 'node:fs/promises';
import { join, dirname } from 'node:path';
import { createHash } from 'node:crypto';
import { ROOT } from '../src/config.ts';
import { runCommand } from '../src/executor.ts';
import { pathToFileURL } from 'node:url';
export const CASES = ['start-stack', 'stop-stack', 'restart-backend', 'test-build', 'generate-client', 'publish-local', 'rollback-local', 'partial-stack'] as const;
export type DeveloperCase = typeof CASES[number] | 'backend-failure' | 'changed-script' | 'start-and-edit';
export const PROMPTS: Record<DeveloperCase, string> = {
  'start-stack': '启动这个项目的后端和前端；确认后端就绪后再启动前端，最后检查两边都能访问。',
  'stop-stack': '暂停这个项目的开发服务：先停前端，再停后端，确认两边都停止。',
  'restart-backend': '重启这个项目的后端并检查健康状态，保持前端原有进程运行。',
  'test-build': '运行这个项目的单元测试，然后重新构建，确认构建产物对应当前源代码。',
  'generate-client': '按当前 schema.json 重新生成 API 客户端文件，并检查生成结果。',
  'publish-local': '将当前代码发布到项目 README 指定的本地 releases 目录：先测试、再构建、再发布，并确认当前发布版本。',
  'rollback-local': '将项目本地发布回滚到上一版本，确认当前发布指向上一版本。',
  'partial-stack': '后端已经启动，保持它的进程不变，只把前端启动并检查能访问。',
  'backend-failure': '启动项目的后端和前端；如果后端启动失败，不要启动前端，不要修改配置，明确报告失败原因。',
  'changed-script': '按当前 schema.json 重新生成 API 客户端文件，并检查生成结果。',
  'start-and-edit': '启动项目的后端和前端，然后在 src/math.mjs 保留 total 并新增导出函数 average(values)，计算数字数组的平均数，空数组返回 0。改完运行现有单元测试并构建，确认服务仍可访问并说明改动。不要改 dev.mjs。',
};
const originalSource = 'export const total = values => values.reduce((sum, value) => sum + value, 0);\n';
const digest = (x: string | Buffer) => createHash('sha256').update(x).digest('hex');
export async function command(root: string, cmd: string) {
  return runCommand(root, { command: process.execPath, args: ['dev.mjs', cmd], cwd: '.', timeoutMs: 12000 });
}
async function put(root: string, file: string, data: unknown) { await mkdir(dirname(join(root, file)), { recursive: true }); await writeFile(join(root, file), JSON.stringify(data, null, 2)); }
export async function createDeveloperProject(root: string) {
  await mkdir(join(root, 'src'), { recursive: true });
  await mkdir(join(root, '.dev'), { recursive: true });
  await cp(join(ROOT, 'benchmarks/developer-workflows/dev.mjs'), join(root, 'dev.mjs'));
  await writeFile(join(root, 'src/math.mjs'), originalSource);
  await put(root, 'project.json', { name: 'developer-demo', version: '2.0.0', failBackend: false });
  await put(root, 'schema.json', { endpoints: [{ name: 'getUsers', path: '/users' }, { name: 'getHealth', path: '/health' }] });
  await writeFile(join(root, 'README.md'), `# Developer demo\n\nUse the existing scripts. No network package install is needed. Run commands as node dev.mjs <operation> in this directory. Node is available.\n\n| Operation | Effect | Verify |\n|---|---|---|\n| start-backend | Start backend in background, await health, return | verify-backend |\n| start-frontend | Start frontend in background after backend is healthy | verify-frontend |\n| stop-frontend | Stop only this project's frontend | verify-frontend-stopped |\n| stop-backend | Stop only this project's backend | verify-backend-stopped |\n| restart-backend | Restart backend, preserving frontend | verify-backend |\n| test | Run unit tests | verify-tests |\n| build | Rebuild current source | verify-build |\n| generate-client | Regenerate generated/client.ts from current schema.json | verify-client |\n| publish | Require current tests/build, copy to local releases, update deployment.json | verify-release |\n| rollback | Switch deployment.json to its previous release | verify-release |\n| status | Inspect live backend/frontend | read only |\n\nAll verification commands exit nonzero on failure and print OK on success. Service start commands return after readiness; existing healthy services are kept. Stop uses a project-instance HTTP shutdown endpoint, not arbitrary PID killing. Servers auto-expire after 20 minutes. No real external deployment exists. Keep the version-control script dev.mjs unchanged unless explicitly asked; project.json and schema.json are variable inputs. Only independently useful operations need separate reuse; do not combine frontend/backend startup into one new script here because either can be requested individually.\n`);
}
export async function cleanupDeveloperProject(root: string) {
  for (const role of ['frontend', 'backend']) {
    const result = await command(root, 'stop-' + role); if (result.exitCode !== 0) throw new Error(result.output);
  }
}
async function service(root: string, role: string) {
  try {
    const info = JSON.parse(await readFile(join(root, `.dev/${role}.json`), 'utf8'));
    const response = await fetch(info.url + '/health', { signal: AbortSignal.timeout(800) });
    if (!response.ok) return null;
    const live = await response.json() as any;
    return live.instance === info.instance ? live : null;
  } catch { return null; }
}
export async function prepareDeveloperCase(root: string, scenario: DeveloperCase) {
  await cleanupDeveloperProject(root);
  await writeFile(join(root, 'src/math.mjs'), originalSource);
  for (const file of ['build/manifest.json', 'build/math.mjs', '.dev/test.json', 'generated/client.ts']) await rm(join(root, file), { force: true });
  await put(root, 'project.json', { name: 'developer-demo', version: '2.0.0', failBackend: scenario === 'backend-failure' });
  await put(root, 'schema.json', { endpoints: [{ name: 'getUsers', path: '/users' }, { name: 'getHealth', path: '/health' }] });
  await put(root, 'releases/release-old/manifest.json', { version: '1.0.0', sourceHash: 'old-source' });
  await put(root, 'releases/release-current/manifest.json', { version: '1.5.0', sourceHash: 'current-source' });
  await put(root, 'deployment.json', { current: 'release-current', previous: 'release-old' });
  if (['stop-stack', 'restart-backend', 'partial-stack'].includes(scenario)) {
    assert.equal((await command(root, 'start-backend')).exitCode, 0);
    if (scenario !== 'partial-stack') assert.equal((await command(root, 'start-frontend')).exitCode, 0);
  }
  if (scenario === 'changed-script') await writeFile(join(root, 'dev.mjs'), (await readFile(join(root, 'dev.mjs'), 'utf8')) + '\n// Reviewed implementation update: same command interface.\n');
  await writeFile(join(root, '.dev/events.jsonl'), '');
  return { backend: await service(root, 'backend'), frontend: await service(root, 'frontend'),
    scriptHash: digest(await readFile(join(root, 'dev.mjs'))), sourceHash: digest(await readFile(join(root, 'src/math.mjs'))),
    projectConfig: await readFile(join(root, 'project.json'), 'utf8'), schema: await readFile(join(root, 'schema.json'), 'utf8') };
}
export async function verifyDeveloperCase(root: string, scenario: DeveloperCase, before: Awaited<ReturnType<typeof prepareDeveloperCase>>) {
  try {
    const backend = await service(root, 'backend'), frontend = await service(root, 'frontend');
    const events = (await readFile(join(root, '.dev/events.jsonl'), 'utf8')).trim().split('\n').filter(Boolean).map(l => JSON.parse(l));
    const names = events.map(e => e.event);
    const json = async (file: string) => JSON.parse(await readFile(join(root, file), 'utf8'));
    assert.equal(digest(await readFile(join(root, 'dev.mjs'))), before.scriptHash, 'Control script changed during task');
    assert.equal(await readFile(join(root, 'project.json'), 'utf8'), before.projectConfig, 'Project configuration changed');
    assert.equal(await readFile(join(root, 'schema.json'), 'utf8'), before.schema, 'Schema input changed');
    const sourceHash = digest(await readFile(join(root, 'src/math.mjs')));
    if (scenario !== 'start-and-edit') assert.equal(sourceHash, before.sourceHash, 'Source was changed');
    if (scenario === 'start-and-edit') {
      assert.ok(backend && frontend, 'Both services must remain reachable');
      assert.ok(names.indexOf('backend-started') >= 0 && names.indexOf('backend-started') < names.indexOf('frontend-started'));
      const module = await import(pathToFileURL(join(root, 'src/math.mjs')).href + '?verify=' + Date.now());
      assert.equal(module.total([2, 3, 7]), 12); assert.equal(module.average([2, 4, 9]), 5);
      assert.equal(module.average([]), 0); assert.equal(module.average([-3, 1]), -1);
      assert.equal((await json('.dev/test.json')).sourceHash, sourceHash);
      assert.equal((await json('build/manifest.json')).sourceHash, sourceHash);
      assert.equal(digest(await readFile(join(root, 'build/math.mjs'))), sourceHash);
      assert.ok(names.indexOf('tests-passed') >= 0 && names.indexOf('tests-passed') < names.indexOf('build-complete'));
    } else if (scenario === 'start-stack' || scenario === 'partial-stack') {
      assert.ok(backend && frontend, 'Both services must be reachable');
      if (scenario === 'partial-stack') assert.equal(backend.instance, before.backend.instance, 'Backend must not restart');
      else assert.ok(names.indexOf('backend-started') >= 0 && names.indexOf('backend-started') < names.indexOf('frontend-started'), 'Backend must start first');
    } else if (scenario === 'stop-stack') {
      assert.ok(!backend && !frontend, 'Services still running');
      assert.ok(names.indexOf('frontend-stopped') >= 0 && names.indexOf('frontend-stopped') < names.indexOf('backend-stopped'), 'Stop frontend first');
    } else if (scenario === 'restart-backend') {
      assert.ok(backend && frontend); assert.notEqual(backend.instance, before.backend.instance); assert.equal(frontend.instance, before.frontend.instance);
    } else if (scenario === 'test-build' || scenario === 'publish-local') {
      const tests = await json('.dev/test.json'), build = await json('build/manifest.json');
      assert.equal(tests.passed, true); assert.equal(tests.sourceHash, before.sourceHash); assert.equal(build.sourceHash, before.sourceHash);
      assert.equal(digest(await readFile(join(root, 'build/math.mjs'))), before.sourceHash);
      assert.ok(names.indexOf('tests-passed') >= 0 && names.indexOf('tests-passed') < names.indexOf('build-complete'));
      if (scenario === 'publish-local') {
        const deploy = await json('deployment.json'); assert.notEqual(deploy.current, 'release-current');
        assert.equal((await json(`releases/${deploy.current}/manifest.json`)).sourceHash, before.sourceHash);
        assert.equal(digest(await readFile(join(root, `releases/${deploy.current}/math.mjs`))), before.sourceHash);
        assert.ok(names.indexOf('build-complete') < names.indexOf('published'));
      }
    } else if (scenario === 'generate-client' || scenario === 'changed-script') {
      assert.equal(await readFile(join(root, 'generated/client.ts'), 'utf8'), 'export const getUsers = "/users";\nexport const getHealth = "/health";\n');
    } else if (scenario === 'rollback-local') assert.equal((await json('deployment.json')).current, 'release-old');
    else if (scenario === 'backend-failure') { assert.ok(!backend && !frontend); assert.ok(names.includes('backend-failed')); assert.ok(!names.includes('frontend-started')); }
    return { success: true, error: null, events, backend, frontend };
  } catch (error) { return { success: false, error: String(error) }; }
}
