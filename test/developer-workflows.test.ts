import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { CASES, EXTRA_CASES, createDeveloperProject, cleanupDeveloperProject, prepareDeveloperCase, verifyDeveloperCase, command, type DeveloperCase } from '../scripts/developer-fixtures.ts';
import { Store } from '../src/store.ts';
import { createAction } from '../src/learning.ts';
import { validateRecipe, runCommand } from '../src/executor.ts';
import { createHost, runTurn } from '../src/dsh/host.ts';

test('developer fixture verifies real service effects, command ordering and local release contents', async () => {
  const root = await mkdtemp(join(tmpdir(), 'jev-dev-fixture-'));
  await createDeveloperProject(root);
  const commands: Record<DeveloperCase, string[]> = {
    'start-stack': ['start-backend', 'start-frontend'], 'stop-stack': ['stop-frontend', 'stop-backend'],
    'restart-backend': ['restart-backend'], 'test-build': ['test', 'build'], 'generate-client': ['generate-client'],
    'publish-local': ['test', 'build', 'publish'], 'rollback-local': ['rollback'], 'partial-stack': ['start-frontend'],
    'backend-failure': ['start-backend'], 'changed-script': ['generate-client'],
    'start-and-edit': ['start-backend', 'start-frontend', 'test', 'build'],
    'start-script': [], 'start-script-again': [], 'changed-schema': ['generate-client'],
    'edit-generate-explain': ['generate-client'], 'test-edit-test': ['test', 'build'], 'no-save': [], 'explain-only': [], 'unknown-project': [],
  };
  try {
    for (const scenario of [...CASES, 'backend-failure', 'changed-script', 'start-and-edit', ...EXTRA_CASES] as DeveloperCase[]) {
      const before = await prepareDeveloperCase(root, scenario);
      if (scenario === 'test-edit-test') assert.equal((await command(root,'test')).exitCode, 0);
      if (['start-and-edit','test-edit-test'].includes(scenario)) await writeFile(join(root, 'src/math.mjs'), 'export const total = a => a.reduce((s,v) => s+v, 0);\nexport const average = a => a.length ? total(a)/a.length : 0;\n');
      if (scenario.startsWith('start-script')) assert.equal((await runCommand(root,{command:process.execPath,args:['start-stack.mjs'],cwd:'.',timeoutMs:12000})).exitCode,0);
      if (scenario === 'edit-generate-explain') await writeFile(join(root,'schema.json'),JSON.stringify({endpoints:[{name:'getUsers',path:'/users'},{name:'getHealth',path:'/health'},{name:'getOrders',path:'/orders'}]}));
      for (const operation of commands[scenario]) assert.equal((await command(root, operation)).exitCode, scenario === 'backend-failure' ? 1 : 0);
      const verified = await verifyDeveloperCase(root, scenario, before);
      assert.equal(verified.success, true, `${scenario}: ${verified.error}`);
    }
  } finally { await cleanupDeveloperProject(root); }
});

test('Jev can hand off unfinished work to the model and resume actions after the model tool result', async () => {
  const base = await mkdtemp(join(tmpdir(), 'jev-mixed-actions-')), cwd = join(base, 'project');
  await createDeveloperProject(cwd);
  const store = new Store(join(base, 'store'));
  await store.addProject({ id: 'demo', name: 'demo', root: cwd, aliases: [], description: 'Developer mixed task' });
  try {
    for (const [id, operations, verify] of [
      ['start_stack', ['start-backend', 'start-frontend'], 'verify-frontend'],
      ['test_build', ['test', 'build'], 'verify-build'],
    ] as const) {
      await createAction(store, 'demo', { actionId: id, description: id, recipe: {
        id, steps: operations.map(operation => ({ command: process.execPath, args: ['dev.mjs', operation] })),
        verify: { command: { command: process.execPath, args: ['dev.mjs', verify] }, contains: 'OK' }, watchedFiles: ['dev.mjs'],
      } });
      await validateRecipe(store, id);
    }
    const before = await prepareDeveloperCase(cwd, 'start-and-edit');
    const ids = ['start_stack', 'demo', 'LLM', 'test_build', 'demo', 'LLM'];
    let mainCalls = 0;
    const host = await createHost({ home: store.home, cwd, projectId: 'demo', decider: {
      async choose(request) {
        if (ids[0] === 'test_build') assert.match(JSON.stringify(request.state.modelInput), /average/);
        return { id: ids.shift()!, confidence: 0.1 };
      },
    }, chat: { async complete(messages) {
      mainCalls++;
      if (mainCalls === 1) {
        assert.match(JSON.stringify(messages), /start_stack/);
        return { finishReason: 'tool_calls', message: { role: 'assistant', content: null, tool_calls: [{
          id: 'write-average', type: 'function', function: { name: 'write_file', arguments: JSON.stringify({
            path: 'src/math.mjs', content: 'export const total = a => a.reduce((s,v) => s+v, 0);\nexport const average = a => a.length ? total(a)/a.length : 0;\n',
          }) },
        }] } };
      }
      assert.match(JSON.stringify(messages), /test_build/);
      return { finishReason: 'stop', message: { role: 'assistant', content: 'Added average, started services and verified the current build.' } };
    } } });
    try {
      const handle = await host.create();
      const turn = await runTurn(handle.agent, 'Start services, add average(values), then test and build. Explain the change.');
      const checked = await verifyDeveloperCase(cwd, 'start-and-edit', before);
      assert.equal(turn.outcome?.kind, 'completed'); assert.equal(checked.success, true, checked.error ?? '');
      assert.equal(mainCalls, 2); assert.equal(ids.length, 0);
      assert.equal(turn.actions.filter(e => e.kind === 'jevaction/decision' && e.plan.kind === 'action').length, 2);
    } finally { await host.dispose(); }
  } finally { await cleanupDeveloperProject(cwd); }
});

test('real DSH loop selects backend then frontend on two separate decisions with their results in shared history', async () => {
  const base = await mkdtemp(join(tmpdir(), 'jev-two-actions-')), cwd = join(base, 'project');
  await createDeveloperProject(cwd);
  const store = new Store(join(base, 'store'));
  await store.addProject({ id: 'demo', name: 'demo', root: cwd, aliases: [], description: 'Developer services' });
  try {
    for (const role of ['backend', 'frontend']) {
      await createAction(store, 'demo', { actionId: 'start_' + role, description: `Start ${role} and verify health`, recipe: {
        id: 'start-' + role, steps: [{ command: process.execPath, args: ['dev.mjs', 'start-' + role] }],
        verify: { command: { command: process.execPath, args: ['dev.mjs', 'verify-' + role] }, contains: 'OK' }, watchedFiles: ['dev.mjs'],
      } });
      await validateRecipe(store, 'start-' + role);
    }
    const before = await prepareDeveloperCase(cwd, 'start-stack');
    const ids = ['start_backend', 'demo', 'start_frontend', 'demo', 'DONE'];
    const decisions: any[] = [];
    const host = await createHost({ home: store.home, cwd, projectId: 'demo', decider: {
      async choose(request) {
        decisions.push(request);
        if (request.state.stage === 'action' && ids[0] === 'start_frontend') {
          assert.match(JSON.stringify(request.state.modelInput), /start_backend/);
          assert.match(JSON.stringify(request.state.modelInput), /verified/);
        }
        return { id: ids.shift()!, confidence: 0.1 };
      },
    }, chat: { async complete() { throw new Error('No main model is needed for this fixture'); } } });
    try {
      const handle = await host.create();
      const turn = await runTurn(handle.agent, 'Start backend, then frontend after backend is ready.');
      assert.equal(turn.outcome?.kind, 'completed'); assert.equal(host.adapter.calls, 0);
      assert.equal((await verifyDeveloperCase(cwd, 'start-stack', before)).success, true);
      assert.equal(decisions.filter(d => d.state.stage === 'action').length, 3);
      assert.equal(turn.actions.filter(e => e.kind === 'jevaction/decision' && e.plan.kind === 'action').length, 2);
    } finally { await host.dispose(); }
  } finally { await cleanupDeveloperProject(cwd); }
});
