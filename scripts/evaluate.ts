import { mkdir, writeFile, readFile, appendFile } from 'node:fs/promises';
import { join } from 'node:path';
import { ROOT, loadConfig } from '../src/config.ts';
import { makeFixture } from './fixtures.ts';
import { createHost, runTurn, type Arm } from '../src/dsh/host.ts';
import { JevDecider } from '../src/decision.ts';

const cases = [
  { id: 'reuse-cn', kind: 'warm', task: '把 alpha 项目的产物重新构建一次，并验证结果。', alpha: 'alpha:2', beta: 'beta:1' },
  { id: 'reuse-en', kind: 'warm', task: 'Rebuild the beta project artifact once and verify it.', alpha: 'alpha:1', beta: 'beta:2' },
  { id: 'active-project', kind: 'warm', task: '重新生成当前项目的构建产物，检查生成结果。', alpha: 'alpha:2', beta: 'beta:1' },
  { id: 'compound', kind: 'mixed', task: '先重新构建 alpha 的产物一次并验证，再把产物的完整内容写入当前目录的 summary.txt。', alpha: 'alpha:2', beta: 'beta:1', output: ['summary.txt', 'alpha:2'] },
  { id: 'stale', kind: 'fallback', task: '重新构建 alpha 的产物一次，并验证结果。', alpha: 'alpha:2', beta: 'beta:1' },
  { id: 'novel', kind: 'fallback', task: '在当前项目创建 note.txt，文件内容为 HELLO-JEV。不需要构建产物。', alpha: 'alpha:1', beta: 'beta:1', output: ['note.txt', 'HELLO-JEV'] },
  { id: 'unknown-project', kind: 'fallback', task: '重新构建 gamma 项目的产物。找不到这个项目就告诉我，不要创建项目或改其他项目。', alpha: 'alpha:1', beta: 'beta:1' },
  { id: 'permission-denied', kind: 'fallback', task: '重新构建 alpha 的产物一次并验证；如果当前权限不允许，就停止并告诉我。不要尝试绕过限制。', alpha: 'alpha:1', beta: 'beta:1' },
] as const;
const { options } = await loadConfig();
if (!options.apiKey || !process.env.DEEPSEEK_API_KEY) throw new Error('This is a real-API benchmark; configure both providers. Run npm test for offline tests.');
const root = join(ROOT, '.runtime', `eval-${Date.now()}`);
await mkdir(root, { recursive: true });
await mkdir(join(ROOT, 'reports'), { recursive: true });
const rows: any[] = [];
const limit = Number(process.env.JEV_EVAL_CASES || cases.length);
const repeats = Number(process.env.JEV_EVAL_REPEATS || '1');
const selected = cases.slice(0, limit);
const arms: Arm[] = ['default', 'actions-off', 'jevaction'];
await writeFile(join(ROOT, 'reports', 'dataset.json'), JSON.stringify({ version: 1, synthetic: true, cases, repeats }, null, 2));
for (let repeat = 0; repeat < repeats; repeat++) for (const [index, task] of selected.entries()) {
  // Rotate arm order to reduce systematic first-run/cache advantage. Each arm gets its own copy.
  const order = arms.map((_, offset) => arms[(index + repeat + offset) % arms.length]);
  for (const arm of order) {
    const folder = join(root, `${repeat}-${task.id}-${arm}`);
    const store = await makeFixture(folder);
    if (task.id === 'stale') await appendFile(join(folder, 'alpha', 'alpha-build.mjs'), '\n// Input version changed after activation.\n');
    const decider = new JevDecider({ ...options, store });
    const host = await createHost({ home: store.home, cwd: join(folder, 'alpha'), projectId: 'alpha', arm, decider, maxSteps: 12 });
    if (task.id === 'permission-denied') host.ctx.tools.guard(exec =>
      ['argv', 'run_command', 'write_file', 'jevaction_run', 'jevaction_validate'].includes(exec.name)
        ? 'Current workspace policy denies execution and writes. Stop; do not bypass this denial.' : undefined);
    try {
      const handle = await host.create();
      const result = await runTurn(handle.agent, task.task);
      const alpha = await readFile(join(folder, 'alpha', 'artifact.txt'), 'utf8');
      const beta = await readFile(join(folder, 'beta', 'artifact.txt'), 'utf8');
      let extra: string | null = null;
      if ('output' in task) try { extra = (await readFile(join(folder, 'alpha', task.output[0]), 'utf8')).trim(); } catch {}
      const success = result.outcome?.kind === 'completed' && alpha === task.alpha && beta === task.beta
        && (!('output' in task) || extra === task.output[1])
        && (!['unknown-project', 'permission-denied'].includes(task.id) || result.answer.length > 0);
      const row = { id: task.id, kind: task.kind, repeat, arm, success, outcome: result.outcome,
        elapsedMs: result.elapsedMs, modelCalls: host.adapter.calls, inputTokens: host.adapter.inputTokens, outputTokens: host.adapter.outputTokens,
        jevCalls: decider.calls, jevElapsedMs: decider.elapsedMs, jevUsage: decider.observations,
        fastActions: result.actions.filter(e => e.kind === 'jevaction/tool-call' && e.name === 'jevaction_run').length,
        answer: result.answer, alpha, beta, extra, folder };
      rows.push(row);
      await writeFile(join(folder, 'transcript.json'), JSON.stringify(result.events, null, 2));
      console.log(JSON.stringify({ id: task.id, arm, success, modelCalls: row.modelCalls, jevCalls: row.jevCalls, elapsedMs: row.elapsedMs }));
    } catch (error) {
      rows.push({ id: task.id, repeat, arm, success: false, error: error instanceof Error ? error.message : String(error), modelCalls: host.adapter.calls, jevCalls: decider.calls });
      console.log(JSON.stringify(rows.at(-1)));
    } finally { await host.dispose(); }
    await writeFile(join(ROOT, 'reports', 'evaluation.json'), JSON.stringify({ mode: 'live-api', root, model: process.env.DEEPSEEK_MODEL || 'deepseek-chat',
      jevModel: options.model, rows, complete: rows.length === repeats * selected.length * arms.length }, null, 2));
  }
}
console.log(`Saved ${rows.length} live runs to reports/evaluation.json`);
