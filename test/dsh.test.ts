import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, appendFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { makeFixture } from '../scripts/fixtures.ts';
import { createHost, runTurn } from '../src/dsh/host.ts';
import { LiteralDecider } from '../src/decision.ts';
import type { ChatModel, ModelReply } from '../src/model.ts';
import { createUserMessage } from '@deepseek-ai/dsh-llm';
import { shellArguments } from '../src/dsh/runtime.ts';
import { callHostTool } from '../src/dsh/runtime.ts';

const final: ModelReply = { message: { role: 'assistant', content: 'Model handled this request.' }, finishReason: 'stop' };
const noModel: ChatModel = { async complete() { throw new Error('Unexpected main model invocation'); } };
async function fixture() {
  const root = await mkdtemp(join(tmpdir(), 'jev-dsh-'));
  const store = await makeFixture(root);
  return { root, store, cwd: join(root, 'alpha') };
}

test('real DSH replacement loop executes a saved action, renders receipt, and uses no LLM', async () => {
  const { store, cwd } = await fixture();
  const host = await createHost({ home: store.home, cwd, projectId: 'alpha', decider: new LiteralDecider(), chat: noModel });
  try {
    const handle = await host.create();
    const result = await runTurn(handle.agent, 'build_artifact alpha');
    assert.deepEqual(result.outcome, { kind: 'completed' });
    assert.equal(await readFile(join(cwd, 'artifact.txt'), 'utf8'), 'alpha:2');
    assert.equal(host.adapter.calls, 0);
    assert.match(result.answer, /VERIFIED alpha:2/);
    assert.equal(result.actions.filter(e => e.kind === 'jevaction/tool-call').length, 3);
    assert.equal(result.actions.filter(e => e.kind === 'jevaction/tool-result').length, 3);
    await handle.dispose();
  } finally { await host.dispose(); }
});

test('default and actions-off arms really invoke their model and preserve authoring prompt/tools', async () => {
  for (const arm of ['default', 'actions-off'] as const) {
    const { store, cwd } = await fixture();
    const host = await createHost({ home: store.home, cwd, projectId: 'alpha', arm, chat: { async complete(messages, tools) {
      assert.match(messages[0].content!, /persistent JevActions/);
      assert.ok(tools.some(t => t.name === 'jevaction_create'));
      return final;
    } } });
    try {
      const handle = await host.create();
      assert.deepEqual((await runTurn(handle.agent, 'Hello')).outcome, { kind: 'completed' });
      assert.equal(host.adapter.calls, 1);
    } finally { await host.dispose(); }
  }
});

test('official-clean loads no Action runtime, tools or authoring prompt and never calls Jev', async () => {
  const { store, cwd } = await fixture();
  let called = 0;
  const host = await createHost({ home: store.home, cwd, projectId: 'alpha', arm: 'official-clean',
    decider: { async choose() { throw new Error('Official control must not call Jev'); } },
    chat: { async complete(messages, tools) {
      called++;
      assert.ok(!tools.some(t => t.name.startsWith('jevaction_')));
      assert.doesNotMatch(JSON.stringify(messages), /persistent JevActions|jevaction_create|jevaction_validate/);
      assert.ok(tools.some(t => t.name === 'read_file'));
      assert.ok(tools.some(t => t.name === 'run_command'));
      return final;
    } },
  });
  try {
    assert.equal(host.ctx.get('jevActions'), undefined);
    const handle = await host.create();
    const result = await runTurn(handle.agent, 'Read the current project and perform the task.');
    assert.deepEqual(result.outcome, { kind: 'completed' });
    assert.equal(called, 1);
    assert.equal(result.actions.length, 0);
  } finally { await host.dispose(); }
});

test('host denial blocks a nested command; failure observation reaches the main model without pretending success', async () => {
  const { store, cwd } = await fixture();
  const host = await createHost({ home: store.home, cwd, projectId: 'alpha', decider: new LiteralDecider(), chat: {
    async complete(messages) { assert.match(JSON.stringify(messages), /denied by test policy/); return final; },
  } });
  host.ctx.tools.guard(exec => exec.name === 'argv' ? 'denied by test policy' : undefined);
  try {
    const handle = await host.create();
    const result = await runTurn(handle.agent, 'build_artifact alpha');
    assert.deepEqual(result.outcome, { kind: 'completed' });
    assert.equal(host.adapter.calls, 1);
    assert.equal(await readFile(join(cwd, 'artifact.txt'), 'utf8'), 'alpha:1');
    assert.equal(result.actions.filter(e => e.kind === 'jevaction/receipt').length, 0);
  } finally { await host.dispose(); }
});

test('changed script bypasses reuse and delegates to model', async () => {
  const { store, cwd } = await fixture();
  await appendFile(join(cwd, 'alpha-build.mjs'), '\n// updated\n');
  const host = await createHost({ home: store.home, cwd, projectId: 'alpha', decider: new LiteralDecider(), chat: { async complete() { return final; } } });
  try {
    const handle = await host.create();
    const result = await runTurn(handle.agent, 'build_artifact alpha');
    assert.equal(host.adapter.calls, 1);
    assert.equal(result.actions.filter(e => e.kind === 'jevaction/tool-call').length, 0);
  } finally { await host.dispose(); }
});

test('fresh DSH host restores durable session after an action-only turn', async () => {
  const { root, store, cwd } = await fixture();
  const options = { home: store.home, cwd, projectId: 'alpha', decider: new LiteralDecider(), chat: noModel, persistence: join(root, 'sessions') };
  let host = await createHost(options);
  try {
    const handle = await host.create('resume-test');
    assert.deepEqual((await runTurn(handle.agent, 'build_artifact alpha')).outcome, { kind: 'completed' });
    await handle.dispose();
  } finally { await host.dispose(); }
  host = await createHost(options);
  try {
    const handle = await host.create('resume-test', true);
    const result = await runTurn(handle.agent, 'build_artifact beta');
    assert.deepEqual(result.outcome, { kind: 'completed' });
    assert.equal(host.adapter.calls, 0);
    assert.equal(await readFile(join(root, 'beta', 'artifact.txt'), 'utf8'), 'beta:2');
    assert.equal(result.events.find(e => e.type === 'turn/start')?.data.turn, 2);
  } finally { await host.dispose(); }
});

test('cancelling Jev in flight stops the DSH turn and preserves the queued next turn', async () => {
  const { store, cwd } = await fixture();
  let notify!: () => void;
  const entered = new Promise<void>(resolve => { notify = resolve; });
  let calls = 0;
  const host = await createHost({ home: store.home, cwd, projectId: 'alpha', chat: noModel, decider: {
    async choose(request, signal) {
      if (calls++ > 0) return new LiteralDecider().choose(request);
      notify();
      await new Promise<void>((_r, reject) => signal!.addEventListener('abort', () => reject(signal!.reason), { once: true }));
      throw new Error('unreachable');
    },
  } });
  try {
    const handle = await host.create();
    const run = runTurn(handle.agent, 'build_artifact alpha');
    await entered;
    handle.agent.cancel({ kind: 'user' });
    assert.equal((await run).outcome?.kind, 'aborted');
    assert.deepEqual((await runTurn(handle.agent, 'build_artifact beta')).outcome, { kind: 'completed' });
  } finally { await host.dispose(); }
});

test('shell adapter escapes literal argv rather than interpreting embedded shell syntax', () => {
  assert.equal(shellArguments('pwsh', 'node', ["a'b", '$env:SECRET', '`x`']), "& 'node' 'a''b' '$env:SECRET' '`x`'\nexit $LASTEXITCODE");
  assert.match(shellArguments('bash', 'node', ["a'b", '$(x)']), /'\$\(x\)'/);
});

test('a model retry after a fast action receives the prior receipt without duplicating the effect', async () => {
  const { store, cwd } = await fixture();
  let choices = 0;
  const literal = new LiteralDecider();
  let modelCalls = 0;
  const host = await createHost({ home: store.home, cwd, projectId: 'alpha', decider: {
    async choose(request) {
      if (++choices > 2) return { id: 'LLM', confidence: 1 };
      return literal.choose(request);
    },
  }, chat: { async complete() {
    if (modelCalls++ === 0) return { message: { role: 'assistant', content: null, tool_calls: [{
      id: 'repeat', type: 'function', function: { name: 'jevaction_run', arguments: JSON.stringify({ actionId: 'build_artifact', projectId: 'alpha' }) },
    }] }, finishReason: 'tool_calls' };
    return final;
  } } });
  try {
    const handle = await host.create();
    const result = await runTurn(handle.agent, 'build_artifact alpha');
    assert.deepEqual(result.outcome, { kind: 'completed' });
    assert.equal(await readFile(join(cwd, 'artifact.txt'), 'utf8'), 'alpha:2');
    assert.match(JSON.stringify(result.events), /reusedReceipt/);
  } finally { await host.dispose(); }
});

test('unloading the plugin removes its tools and stops owned agents', async () => {
  const { store, cwd } = await fixture();
  const host = await createHost({ home: store.home, cwd, projectId: 'alpha', decider: new LiteralDecider(), chat: noModel });
  try {
    const handle = await host.create();
    const id = handle.agent.id;
    assert.ok(host.ctx.tools.get('jevaction_create', handle.agent));
    await host.fiber.dispose();
    assert.equal(host.ctx.agents.get(id), undefined);
    assert.equal(host.ctx.tools.get('jevaction_create'), undefined);
    await assert.rejects(() => host.create(), /factory|agent/i);
  } finally { await host.dispose(); }
});

test('Jev receives the exact full admitted history and tools that the main model receives', async () => {
  const { store, cwd } = await fixture();
  const views: any[] = []; let calls = 0;
  const host = await createHost({ home: store.home, cwd, projectId: 'alpha', decider: {
    async choose(request) { views.push(structuredClone(request.state.modelInput)); return { id: 'LLM', confidence: 0.05 }; },
  }, chat: { async complete() {
    if (calls++ < 5) return { message: { role: 'assistant', content: null, tool_calls: [{ id: 'read-' + calls,
      type: 'function', function: { name: 'read_file', arguments: '{"path":"README.md"}' } }] }, finishReason: 'tool_calls' };
    return final;
  } } });
  try {
    const handle = await host.create();
    const longRequest = 'EARLY_REQUIREMENT_KEEP_ME ' + 'full context '.repeat(700);
    assert.equal((await runTurn(handle.agent, longRequest)).outcome?.kind, 'completed');
    assert.equal(views.length, host.adapter.requests.length);
    for (const [index, request] of host.adapter.requests.entries()) {
      assert.deepEqual(views[index].messages, request.messages);
      assert.deepEqual(views[index].tools, request.tools ?? []);
      assert.ok(JSON.stringify(views[index].messages).includes(longRequest));
    }
    assert.ok(views.at(-1).messages.length > 4);
    assert.ok(views.at(-1).messages.some((m: any) => m.role === 'tool'));
  } finally { await host.dispose(); }
});

