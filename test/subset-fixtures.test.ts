import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile, readFile, readdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { existsSync } from 'node:fs';
import { TASKS, PYTHON, prepareVariant, verifyProject, python } from '../scripts/subset-fixtures.ts';

test('external log checker accepts correct output and rejects a stale output after input changes', async () => {
  const root = await mkdtemp(join(tmpdir(), 'jev-log-eval-'));
  const expected = await prepareVariant(root, TASKS[0], 0);
  assert.equal((await verifyProject(root, expected)).success, false);
  const output = ['period,severity,count', ...Object.entries(expected.buckets).flatMap(([p, ns]) =>
    (ns as number[]).map((n, i) => `${p},${['ERROR', 'WARNING', 'INFO'][i]},${n}`))].join('\n');
  await writeFile(join(root, 'summary.csv'), output);
  assert.equal((await verifyProject(root, expected)).success, true);
  const changed = await prepareVariant(root, TASKS[0], 2);
  await writeFile(join(root, 'summary.csv'), output);
  assert.equal((await verifyProject(root, changed)).success, false);
});
test('zero-event log files are empty, not a blank line that violates the task contract', async () => {
  const root = await mkdtemp(join(tmpdir(), 'jev-empty-log-eval-'));
  await prepareVariant(root, TASKS[0], 1);
  const contents = await Promise.all((await readdir(join(root, 'logs'))).map(f => readFile(join(root, 'logs', f), 'utf8')));
  assert.ok(contents.some(text => text === ''));
  assert.ok(contents.every(text => text === '' || text.trim().split('\n').every(line => /\b(ERROR|WARNING|INFO)\b/.test(line))));
});

test('fixed-input repeat removes previous results but retains learned scripts and identical inputs', async () => {
  const root = await mkdtemp(join(tmpdir(), 'jev-repeat-eval-'));
  const first = await prepareVariant(root, TASKS[0], 0);
  const files = ['reference_date.txt', ...(await readdir(join(root, 'logs'))).sort().map(f => `logs/${f}`)];
  const before = await Promise.all(files.map(f => readFile(join(root, f), 'utf8')));
  await writeFile(join(root, 'summary.csv'), 'previous result');
  await writeFile(join(root, 'learned.py'), '# retained implementation');
  const repeated = await prepareVariant(root, TASKS[0], 0);
  assert.deepEqual(repeated, first);
  assert.deepEqual(await Promise.all(files.map(f => readFile(join(root, f), 'utf8'))), before);
  await assert.rejects(readFile(join(root, 'summary.csv')), { code: 'ENOENT' });
  assert.equal(await readFile(join(root, 'learned.py'), 'utf8'), '# retained implementation');
});
test('external merger checker checks actual Parquet values, integer IDs and conflicts', { skip: !existsSync(PYTHON) }, async () => {
  const root = await mkdtemp(join(tmpdir(), 'jev-merge-eval-'));
  const expected = await prepareVariant(root, TASKS[1], 2);
  await python('import sys,json,pandas as pd\npd.DataFrame(json.loads(sys.argv[2])).to_parquet(sys.argv[1]+"/merged_users.parquet",index=False)', [root, JSON.stringify(expected.users)]);
  await writeFile(join(root, 'conflicts.json'), JSON.stringify({ total_conflicts: expected.conflicts.length, conflicts: expected.conflicts }));
  assert.equal((await verifyProject(root, expected)).success, true);
  await writeFile(join(root, 'conflicts.json'), JSON.stringify({ total_conflicts: 0, conflicts: [] }));
  assert.equal((await verifyProject(root, expected)).success, false);
});
test('external regex checker does not trust a correct matches file with an incorrect regex', { skip: !existsSync(PYTHON) }, async () => {
  const root = await mkdtemp(join(tmpdir(), 'jev-regex-eval-'));
  const expected = await prepareVariant(root, TASKS[2], 1);
  await writeFile(join(root, 'matches.json'), JSON.stringify(expected.matches));
  await writeFile(join(root, 'regex.txt'), 'NEVER_MATCH');
  assert.equal((await verifyProject(root, expected)).success, false);
  // This checker fixture never enters an agent workspace or prompt.
  const octet = '(?:25[0-5]|2[0-4][0-9]|1[0-9]{2}|[1-9][0-9]?|0)';
  const ip = `(?<![A-Za-z0-9])(?:${octet}\\.){3}${octet}(?![A-Za-z0-9])`;
  const date = '(?<![A-Za-z0-9])[0-9]{4}-(?:(?:01|03|05|07|08|10|12)-(?:0[1-9]|[12][0-9]|3[01])|(?:04|06|09|11)-(?:0[1-9]|[12][0-9]|30)|02-(?:0[1-9]|1[0-9]|2[0-9]))(?![A-Za-z0-9])';
  // The original API uses findall: one capture returns just the last valid date.
  const pattern = `^(?=[^\\n]*${ip})[^\\n]*(${date})`;
  await writeFile(join(root, 'regex.txt'), pattern);
  assert.equal((await verifyProject(root, expected)).success, true);
});
