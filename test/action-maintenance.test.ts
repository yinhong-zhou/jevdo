import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, writeFile, mkdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Store, readiness } from '../src/store.ts';
import { createAction } from '../src/learning.ts';
import { validateRecipe } from '../src/executor.ts';
import { createHost, runTurn } from '../src/dsh/host.ts';
import { callHostTool } from '../src/dsh/runtime.ts';

async function fixture(repeatPolicy: 'once_per_request' | 'if_not_satisfied') {
  const root = await mkdtemp(join(tmpdir(), 'jev-maintenance-')), cwd = join(root, 'project');
  await mkdir(cwd);
  await writeFile(join(cwd, 'input.txt'), 'A');
  await writeFile(join(cwd, 'job.mjs'), `
import {readFile,writeFile} from 'node:fs/promises';
const input = await readFile('input.txt','utf8');
if (process.argv[2] === 'verify') {
  if (await readFile('artifact.txt','utf8').catch(()=>null) !== input) process.exit(1);
  console.log('VERIFIED');
} else {
  const count = Number(await readFile('count.txt','utf8').catch(()=>0))+1;
  await writeFile('artifact.txt',input); await writeFile('count.txt',String(count));
  console.log('RUN '+count);
}
`);
  const store = new Store(join(root, 'store'));
  await store.addProject({ id: 'demo', name: 'demo', root: cwd, description: '', aliases: [] });
  await createAction(store, 'demo', { actionId: 'refresh', description: 'Produce current artifact from input', recipe: {
    id: 'refresh-v1', steps: [{ command: process.execPath, args: ['job.mjs'] }],
    verify: { command: { command: process.execPath, args: ['job.mjs','verify'] }, contains: 'VERIFIED' }, watchedFiles: ['job.mjs'], repeatPolicy,
  } });
  await validateRecipe(store, 'refresh-v1');
  return { cwd, store };
}

test('input edits preserve activation while repeatable actions refresh their result in the same request', async () => {
  const { cwd, store } = await fixture('if_not_satisfied');
  const ids = ['refresh', 'demo', 'LLM', 'refresh', 'demo', 'LLM', 'LLM'];
  let modelCalls = 0;
  const host = await createHost({ home: store.home, cwd, projectId: 'demo', decider: {
    async choose() { return { id: ids.shift()!, confidence: 0.05 }; },
  }, chat: { async complete() {
    if (modelCalls === 2) return { finishReason: 'stop', message: { role: 'assistant', content: 'Generated B and verified it.' } };
    const call = modelCalls++ === 0
      ? { name: 'write_file', arguments: JSON.stringify({ path: 'input.txt', content: 'B' }) }
      : { name: 'jevaction_run', arguments: JSON.stringify({ actionId: 'refresh', projectId: 'demo' }) };
    return { finishReason: 'tool_calls', message: { role: 'assistant', content: null,
      tool_calls: [{ id: 'step-'+modelCalls, type: 'function', function: call }] } };
  } } });
  try {
    const handle = await host.create();
    const result = await runTurn(handle.agent, 'Generate once, change input to B, generate again, then verify once more.');
    assert.equal(result.outcome?.kind, 'completed');
    assert.equal(await readFile(join(cwd,'artifact.txt'),'utf8'), 'B');
    // One setup validation, two genuine executions; the third request rechecks only.
    assert.equal(await readFile(join(cwd,'count.txt'),'utf8'), '3');
    assert.equal((await readiness(store, (await store.projects())[0], (await store.recipes())[0])).ready, true);
    const reused = result.events.filter(e => e.type === 'tool/result').some(e => JSON.stringify(e).includes('Current effect verified again'));
    assert.ok(reused); assert.equal(ids.length, 0);
  } finally { await host.dispose(); }
});

test('saving an already executed non-idempotent operation adopts tool evidence instead of running twice', async () => {
  const { cwd, store } = await fixture('once_per_request');
  const commands = [
    { name: 'run_command', arguments: { command: process.execPath, args: ['job.mjs'] } },
    { name: 'read_file', arguments: { path: 'artifact.txt' } },
    { name: 'jevaction_validate', arguments: { recipeId: 'refresh-v1' } },
  ];
  let index = 0;
  const host = await createHost({ home: store.home, cwd, projectId: 'demo', decider: { async choose() { return { id: 'LLM', confidence: 0.1 }; } },
    chat: { async complete() {
      const call = commands[index++];
      return call ? { finishReason: 'tool_calls', message: { role: 'assistant', content: null, tool_calls: [{
        id: 'adopt-'+index, type: 'function', function: { name: call.name, arguments: JSON.stringify(call.arguments) },
      }] } } : { finishReason: 'stop', message: { role: 'assistant', content: 'Saved the observed operation.' } };
    } } });
  try {
    const { agent } = await host.create();
    const result = await runTurn(agent, 'Run this operation once and remember it.');
    assert.equal(result.outcome?.kind, 'completed');
    assert.equal(await readFile(join(cwd,'count.txt'),'utf8'), '2');
    const adopted = result.events.filter(e=>e.type==='tool/result').map(e=>JSON.stringify(e)).filter(t=>t.includes('adoptedExecution'));
    assert.equal(adopted.length, 1); assert.match(adopted[0], /adopt-1/);
  } finally { await host.dispose(); }
});

test('a main-model turn retains final delivery while Jev can still execute intermediate actions', async () => {
  const { cwd, store } = await fixture('if_not_satisfied');
  let modelCalls = 0, routed = 0;
  const host = await createHost({ home: store.home, cwd, projectId: 'demo', decider: {
    async choose(request) {
      routed++;
      if (routed > 1 && request.state.stage === 'action') assert.ok(!request.candidates.some(c=>c.id==='DONE'));
      const id = routed === 1 ? 'LLM' : routed === 2 ? 'refresh' : routed === 3 ? 'demo' : 'LLM';
      return { id, confidence: 0.1 };
    },
  }, chat: { async complete() {
    if (modelCalls++ === 0) return { finishReason: 'tool_calls', message: { role: 'assistant', content: null,
      tool_calls: [{id:'change-input',type:'function',function:{name:'write_file',arguments:'{"path":"input.txt","content":"C"}'}}] } };
    return { finishReason: 'stop', message: { role: 'assistant', content: 'Updated input to C and refreshed the artifact.' } };
  } } });
  try {
    const { agent } = await host.create(); const result = await runTurn(agent,'Change input to C and regenerate. Explain the change.');
    assert.equal(result.outcome?.kind, 'completed'); assert.equal(modelCalls, 2);
    assert.match(result.answer, /Updated input to C/); assert.equal(await readFile(join(cwd,'artifact.txt'),'utf8'), 'C');
  } finally { await host.dispose(); }
});

test('intervening mutation blocks uncertain adoption and never repeats a non-idempotent effect', async () => {
  const { cwd, store } = await fixture('once_per_request');
  const calls = [
    { name:'run_command', arguments:JSON.stringify({command:process.execPath,args:['job.mjs']}) },
    { name:'write_file', arguments:'{"path":"input.txt","content":"changed"}' },
    { name:'jevaction_validate', arguments:'{"recipeId":"refresh-v1"}' },
  ];
  let index=0;
  const host = await createHost({home:store.home,cwd,projectId:'demo',decider:{async choose(){return{id:'LLM',confidence:0.1};}},
    chat:{async complete(){const fn=calls[index++];return fn
      ? {finishReason:'tool_calls',message:{role:'assistant',content:null,tool_calls:[{id:'guard-'+index,type:'function',function:fn}]}}
      : {finishReason:'stop',message:{role:'assistant',content:'Prior execution needs inspection.'}};
    }}});
  try {
    const {agent}=await host.create();const result=await runTurn(agent,'Run once, then inspect a changed input.');
    assert.equal(result.outcome?.kind,'completed');
    assert.match(JSON.stringify(result.events),/cannot be safely adopted/);
    assert.equal(await readFile(join(cwd,'count.txt'),'utf8'),'2');
    assert.equal((await store.receipts()).length,1);
  } finally {await host.dispose();}
});

test('non-idempotent actions remain once per request even after data changes', async () => {
  const { cwd, store } = await fixture('once_per_request');
  const host = await createHost({ home: store.home, cwd, projectId: 'demo' });
  try {
    const { agent } = await host.create();
    const args = { actionId: 'refresh', projectId: 'demo' }, signal = new AbortController().signal;
    await callHostTool(agent, 'jevaction_run', args, signal);
    await writeFile(join(cwd,'input.txt'), 'B');
    const second = JSON.parse(String(await callHostTool(agent, 'jevaction_run', args, signal)));
    assert.equal(second.reusedReceipt, true);
    assert.equal(await readFile(join(cwd,'count.txt'),'utf8'), '2');
    assert.equal(await readFile(join(cwd,'artifact.txt'),'utf8'), 'A');
  } finally { await host.dispose(); }
});

test('concurrent duplicate requests share one effect and a verifier permission error cannot trigger a repeat', async () => {
  const { cwd, store } = await fixture('if_not_satisfied');
  const host = await createHost({ home: store.home, cwd, projectId: 'demo' });
  try {
    const { agent } = await host.create();
    const args = { actionId: 'refresh', projectId: 'demo' }, signal = new AbortController().signal;
    await Promise.all([callHostTool(agent,'jevaction_run',args,signal), callHostTool(agent,'jevaction_run',args,signal)]);
    assert.equal(await readFile(join(cwd,'count.txt'),'utf8'), '2');
    await writeFile(join(cwd,'input.txt'), 'B');
    host.ctx.tools.guard(exec => exec.name === 'argv' ? 'test: deny verifier' : undefined);
    await assert.rejects(callHostTool(agent,'jevaction_run',args,signal), /deny verifier/);
    assert.equal(await readFile(join(cwd,'count.txt'),'utf8'), '2');
  } finally { await host.dispose(); }
});

test('a direct command Action needs no project script or artificial watched file', async () => {
  const root = await mkdtemp(join(tmpdir(), 'jev-command-action-'));
  const store = new Store(join(root, 'store'));
  await store.addProject({ id: 'demo', name: 'demo', root, description: '', aliases: [] });
  await createAction(store, 'demo', { actionId: 'node_version', description: 'Inspect installed Node version', recipe: {
    id: 'version-v1', steps: [{ command: process.execPath, args: ['--version'] }],
    verify: { command: { command: process.execPath, args: ['--version'] }, contains: 'v' }, watchedFiles: [],
  } });
  assert.equal((await validateRecipe(store, 'version-v1')).status, 'verified');
});
