import { readFile, mkdir } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import { resolve, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadConfig, ROOT } from './config.ts';
import { Store } from './store.ts';
import { LiteralDecider } from './decision.ts';
import { createHost, runTurn } from './dsh/host.ts';
import { createAction } from './learning.ts';
import { validateRecipe } from './executor.ts';
import { makeFixture } from '../scripts/fixtures.ts';

export async function main(args: string[]) {
  const [command, ...rest] = args;
  const config = await loadConfig();
  const print = (value: unknown) => console.log(JSON.stringify(value, null, 2));
  if (command === 'doctor') {
    print({ node: process.version, actionHome: config.store.home,
      jevConfigured: Boolean(process.env.TYPESAFE_API_KEY),
      models: config.models.map(m => ({ id: m.id, model: m.model, configured: Boolean(process.env[m.apiKeyEnv]) })),
      fixedModel: config.fixedModel ?? null, liveRequestsSent: 0 });
  } else if (command === 'register') {
    const [id, root, description] = rest;
    if (!id || !root) throw new Error('Usage: register <id> <absolute-project-path> [description]');
    print(await config.store.addProject({ id, name: id, aliases: [id], root: resolve(root), description: description || id }));
  } else if (command === 'list') {
    print({ projects: await config.store.projects(), actions: await config.store.actions(), recipes: await config.store.recipes() });
  } else if (command === 'create') {
    const [projectId, file] = rest;
    if (!projectId || !file) throw new Error('Usage: create <project-id> <action-json-file>');
    print(await createAction(config.store, projectId, JSON.parse(await readFile(resolve(file), 'utf8'))));
  } else if (command === 'validate') {
    if (!rest[0]) throw new Error('Usage: validate <recipe-id>');
    print(await validateRecipe(config.store, rest[0]));
  } else if (command === 'ask') {
    const [projectId, request, mode] = rest;
    if (!projectId || !request) throw new Error('Usage: ask <project-id> <request> [--literal-baseline]');
    if (mode && mode !== '--literal-baseline') throw new Error('Unknown driver flag');
    const decider = mode ? new LiteralDecider() : config.decider;
    const project = (await config.store.projects()).find(p => p.id === projectId);
    if (!project) throw new Error('Register the project before asking');
    const host = await createHost({ home: config.store.home, cwd: project.root, projectId, decider,
      persistence: join(config.store.home, 'sessions') });
    try {
      const handle = await host.create();
      const result = await runTurn(handle.agent, request);
      print({ sessionId: handle.agent.id, outcome: result.outcome, answer: result.answer,
        mainModelCalls: host.adapter.calls, driver: mode ? 'literal-baseline' : 'jev', elapsedMs: result.elapsedMs });
      if (result.outcome?.kind !== 'completed') process.exitCode = 1;
    } finally { await host.dispose(); }
  } else if (command === 'demo') {
    const folder = join(ROOT, '.runtime', `demo-${Date.now()}`); await mkdir(folder, { recursive: true });
    const store = await makeFixture(folder);
    const runs = [];
    for (const id of ['alpha', 'beta']) {
      // Each invocation is a fresh process, reading only the persisted action registry.
      const execution = spawnSync(process.execPath, ['--import', 'tsx', fileURLToPath(import.meta.url), 'ask', id, `build_artifact ${id}`, '--literal-baseline'], {
        cwd: ROOT, env: { ...process.env, JEV_ACTION_HOME: store.home }, encoding: 'utf8', windowsHide: true,
      });
      if (execution.status !== 0) throw new Error(execution.stderr || 'Demo subprocess failed');
      runs.push({ project: id, result: JSON.parse(execution.stdout), artifact: await readFile(join(folder, id, 'artifact.txt'), 'utf8') });
    }
    print({ mode: 'offline-literal-baseline', note: 'Real filesystem operations in separate processes. No Jev/LLM API call; not evidence of model accuracy.', directory: folder, runs });
  } else {
    console.log('JevAction\n  doctor\n  demo\n  register <id> <path> [description]\n  list\n  create <project-id> <action.json>\n  validate <recipe-id>\n  ask <project-id> <request> [--literal-baseline]');
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main(process.argv.slice(2)).catch(error => { console.error(error instanceof Error ? error.message : String(error)); process.exitCode = 1; });
}
