import { mkdir, writeFile, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { ROOT, loadConfig } from '../src/config.ts';
import { Store, readiness } from '../src/store.ts';
import { createHost, runTurn } from '../src/dsh/host.ts';
import { JevDecider } from '../src/decision.ts';

const { options } = await loadConfig();
if (!options.apiKey || !process.env.DEEPSEEK_API_KEY) throw new Error('Configure Jev and DeepSeek before this live experiment');
const root = join(ROOT, '.runtime', `learning-${Date.now()}`);
const cwd = join(root, 'report-project');
await mkdir(cwd, { recursive: true });
await writeFile(join(cwd, 'data.json'), JSON.stringify([3, 5, 8]));
await writeFile(join(cwd, 'report.mjs'), `import {readFile,writeFile} from 'node:fs/promises';
const expected=JSON.parse(await readFile('data.json','utf8')).reduce((a,b)=>a+b,0);
if(process.argv[2]==='verify'){if(await readFile('report.txt','utf8')!==String(expected))process.exit(2);console.log('REPORT_OK '+expected);}
else {await writeFile('report.txt',String(expected));console.log('REPORT_GENERATED');}
`);
await writeFile(join(cwd, 'README.md'), '# Report project\nGenerate: node report.mjs\nVerify: node report.mjs verify\nreport.txt must equal the sum of the values in data.json. data.json is variable input, report.mjs is the stable implementation.\n');
const store = new Store(join(root, 'store'));
await store.addProject({ id: 'report', name: 'report', aliases: ['report'], root: cwd, description: 'Generate and verify a sum report.' });
const learningJev = new JevDecider({ ...options, store });
let host = await createHost({ home: store.home, cwd, projectId: 'report', decider: learningJev, persistence: join(root, 'sessions') });
let cold: unknown;
try {
  const handle = await host.create();
  const result = await runTurn(handle.agent, '请阅读 README，把生成 report.txt 并验证结果这一操作保存成可复用的 JevAction，然后执行验证，使它以后可以跨会话直接复用。不要先执行生成后再验证入库，以免执行两遍。');
  const recipe = (await store.recipes()).at(-1);
  const project = (await store.projects())[0];
  cold = { outcome: result.outcome, answer: result.answer, modelCalls: host.adapter.calls, inputTokens: host.adapter.inputTokens,
    outputTokens: host.adapter.outputTokens, jevCalls: learningJev.calls, elapsedMs: result.elapsedMs,
    recipe, ready: recipe ? await readiness(store, project, recipe) : null,
    transcript: result.events };
  await writeFile(join(root, 'cold.json'), JSON.stringify(cold, null, 2));
  if (!recipe || !(await readiness(store, project, recipe)).ready) throw new Error('The real model did not produce an activated Action; see cold.json');
} finally { await host.dispose(); }
// Discard the complete DSH host/conversation and alter only task data, not the stored code.
await writeFile(join(cwd, 'data.json'), JSON.stringify([10, 20, 30]));
const warmJev = new JevDecider({ ...options, store });
host = await createHost({ home: store.home, cwd, projectId: 'report', decider: warmJev });
try {
  const handle = await host.create();
  const result = await runTurn(handle.agent, '重新生成一下这个项目的报表，并验证结果。');
  const artifact = await readFile(join(cwd, 'report.txt'), 'utf8');
  const report = { mode: 'live-api', root, cold, warm: { outcome: result.outcome, artifact,
    success: artifact === '60' && result.outcome?.kind === 'completed', modelCalls: host.adapter.calls,
    inputTokens: host.adapter.inputTokens, outputTokens: host.adapter.outputTokens,
    jevCalls: warmJev.calls, elapsedMs: result.elapsedMs, answer: result.answer, transcript: result.events } };
  await mkdir(join(ROOT, 'reports'), { recursive: true });
  await writeFile(join(ROOT, 'reports', 'live-learning.json'), JSON.stringify(report, null, 2));
  console.log(JSON.stringify({ root, coldModelCalls: (cold as any).modelCalls, warm: { ...report.warm, transcript: undefined } }, null, 2));
  if (!report.warm.success) process.exitCode = 1;
} finally { await host.dispose(); }
