import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, writeFile, appendFile, symlink } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Store, readiness, within } from '../src/store.ts';
import { makeFixture } from '../scripts/fixtures.ts';
import { executePlan, runCommand, projectFiles } from '../src/executor.ts';
import { planNext, runActions, chooseModel } from '../src/controller.ts';
import { LiteralDecider, validateChoice, JevDecider } from '../src/decision.ts';
import { createAction } from '../src/learning.ts';
import type { ChoiceRequest, Decider, ModelOption } from '../src/contracts.ts';

class Scripted implements Decider {
  readonly ids: string[]; calls: ChoiceRequest[] = [];
  constructor(ids: string[]) { this.ids = [...ids]; }
  async choose(request: ChoiceRequest) { this.calls.push(request); return { id: this.ids.shift() ?? 'LLM', confidence: 1 }; }
}
async function fixture(ids?: string[]) { return makeFixture(await mkdtemp(join(tmpdir(), 'jevaction-test-')), ids); }

test('durable project bindings: fresh Store instances reuse different verified scripts', async () => {
  const initial = await fixture();
  for (const id of ['alpha', 'beta']) {
    const store = new Store(initial.home);
    const decider = new Scripted(['build_artifact', id, 'DONE']);
    const result = await runActions(store, decider, { request: `Rebuild ${id}`, activeProject: id });
    assert.equal(result.outcome, 'done'); assert.equal(result.results[0].status, 'verified');
    const project = (await store.projects()).find(p => p.id === id)!;
    assert.equal(await readFile(join(project.root, 'artifact.txt'), 'utf8'), `${id}:2`);
    assert.equal(decider.calls[1].candidates.find(c => c.id === id)?.metadata?.readiness, 'verified');
  }
});

test('drafts do not become executable by merely saving them', async () => {
  const store = await fixture(['alpha']);
  await createAction(store, 'alpha', { actionId: 'new_build', description: 'Another build', recipe: {
    id: 'draft', steps: [{ command: process.execPath, args: ['alpha-build.mjs'] }],
    verify: { command: { command: process.execPath, args: ['alpha-build.mjs', 'verify'] }, contains: 'VERIFIED' }, watchedFiles: ['alpha-build.mjs'],
  } });
  const selector = new Scripted(['new_build', 'alpha']);
  const plan = await planNext(store, selector, { request: 'Another build' });
  assert.equal(plan.kind, 'llm');
  assert.ok(!selector.calls[1].candidates.some(c => c.id === 'alpha'));
});

test('changed watched input invalidates selection and already-created plans', async () => {
  const store = await fixture(['alpha']);
  const plan = await planNext(store, new Scripted(['build_artifact', 'alpha']), { request: 'Build alpha' });
  assert.equal(plan.kind, 'action'); if (plan.kind !== 'action') return;
  const project = (await store.projects())[0];
  await appendFile(join(project.root, 'alpha-build.mjs'), '\n// changed\n');
  const result = await executePlan(store, plan);
  assert.equal(result.status, 'failed'); assert.match(result.error!, /stale/);
  assert.equal(await readFile(join(project.root, 'artifact.txt'), 'utf8'), 'alpha:1');
});

test('wrong project substitution cannot execute a valid recipe from another project', async () => {
  const store = await fixture();
  const recipe = (await store.recipes())[0]; const project = (await store.projects())[0];
  const state = await readiness(store, project, recipe);
  const result = await executePlan(store, { kind: 'action', actionId: recipe.actionId, projectId: 'beta', recipeId: recipe.id, fingerprint: state.fingerprint });
  assert.equal(result.status, 'failed');
});

test('hierarchical parameter selection supplies files only after selecting a project', async () => {
  const store = await fixture(['alpha']);
  const project = (await store.projects())[0]; const listing = await projectFiles(project);
  const index = listing.files.indexOf('README.md');
  const selector = new Scripted(['read_file', 'alpha', `f${index}`, 'DONE']);
  const result = await runActions(store, selector, { request: 'Read alpha README.md' });
  assert.equal(result.outcome, 'done'); assert.match(result.results[0].output, /repeatable build/);
  assert.equal(selector.calls[2].state.projectId, 'alpha');
});

test('success of a substep does not force completion; main model may still be needed', async () => {
  const store = await fixture(['alpha']);
  const result = await runActions(store, new Scripted(['list_files', 'alpha', 'LLM']), { request: 'List files and explain the architecture' });
  assert.equal(result.outcome, 'llm'); assert.equal(result.results.length, 1);
});

test('unknown IDs, API failures, ambiguity, and failure evidence do not execute a guessed command', async () => {
  const store = await fixture(['alpha']);
  assert.equal((await planNext(store, new Scripted(['invented']), { request: 'anything' })).kind, 'llm');
  assert.equal((await planNext(store, { choose: async () => { throw new Error('offline'); } }, { request: 'anything' })).kind, 'llm');
  assert.equal((await planNext(store, new Scripted(['ASK']), { request: 'start that one' })).kind, 'ask');
  const selector = new Scripted([]);
  assert.equal((await planNext(store, selector, { request: 'retry', results: [{ id: '1', actionId: 'x', projectId: 'alpha', status: 'failed', output: '', elapsedMs: 1 }] })).kind, 'llm');
  assert.equal(selector.calls.length, 0);
});

test('confidence is observational; malformed, incomplete and non-argmax outputs are rejected', () => {
  const good = { choice: 'a', confidence: 0.9, probabilities: { a: 0.8, b: 0.2 } };
  assert.equal(validateChoice(good, ['a','b']).id, 'a');
  assert.equal(validateChoice({ ...good, confidence: 0.1 }, ['a','b']).id, 'a');
  for (const bad of [null, { ...good, confidence: NaN }, { ...good, choice: 'x' },
    { ...good, probabilities: { a: 1 } }, { ...good, probabilities: { a: 0.1, b: 0.9 } },
    { ...good, probabilities: { a: NaN, b: 0.2 } }]) assert.throws(() => validateChoice(bad, ['a','b']));
});

test('a low-confidence legal choice still routes to its saved action', async () => {
  const store = await fixture(['alpha']);
  const ids = ['build_artifact', 'alpha', 'DONE'];
  const result = await runActions(store, { async choose() { return { id: ids.shift()!, confidence: 0.1 }; } }, { request: 'Rebuild alpha' });
  assert.equal(result.outcome, 'done');
  assert.equal(result.results[0].status, 'verified');
});

test('model routing respects capabilities and fixed choice without contacting the judge', async () => {
  const models: ModelOption[] = ['a','b'].map(id => ({ id, model: id, apiKeyEnv: 'KEY', baseUrl: 'http://localhost', description: id, capabilities: ['text','tools'], contextWindow: 10000 }));
  const selector = new Scripted(['b']);
  assert.equal((await chooseModel(selector, 'task', models, { fixed: 'a' })).id, 'a');
  assert.equal(selector.calls.length, 0);
  assert.equal((await chooseModel(selector, 'task', models)).id, 'b');
  await assert.rejects(chooseModel(selector, 'image task', models, { requiredCapabilities: ['image'] }));
});

test('executor enforces realpath scope, timeout, abort, and does not forward API keys', async () => {
  const store = await fixture(['alpha']); const project = (await store.projects())[0];
  await assert.rejects(within(project.root, '..'), /scope/);
  await assert.rejects(runCommand(project.root, { command: process.execPath, args: ['-e','setTimeout(()=>{}, 5000)'], cwd: '.', timeoutMs: 100 }), /timed out/);
  const abort = new AbortController(); abort.abort();
  await assert.rejects(runCommand(project.root, { command: process.execPath, args: [], cwd: '.', timeoutMs: 1000 }, abort.signal));
  process.env.JEVACTION_TEST_API_KEY = 'local-test-secret';
  const output = await runCommand(project.root, { command: process.execPath, args: ['-e','console.log(Boolean(process.env.JEVACTION_TEST_API_KEY))'], cwd: '.', timeoutMs: 1000 });
  delete process.env.JEVACTION_TEST_API_KEY;
  assert.equal(output.output.trim(), 'false');
});

test('verifier failure is not treated as success even if execution exited zero', async () => {
  const store = await fixture(['alpha']); const project = (await store.projects())[0];
  const plan = await planNext(store, new Scripted(['build_artifact','alpha']), { request: 'build' });
  assert.equal(plan.kind, 'action'); if (plan.kind !== 'action') return;
  // Change untracked output location into a directory: builder fails; no DONE path is accepted.
  await writeFile(join(project.root, 'artifact.txt'), 'corrupt');
  const result = await executePlan(store, plan);
  assert.equal(result.status, 'failed'); assert.match(result.error!, /Verification failed/);
});
