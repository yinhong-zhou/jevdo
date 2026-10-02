import assert from 'node:assert/strict';
import { readFile, readdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import { ROOT } from '../src/config.ts';
const root = join(ROOT, 'reports/reuse-subset');
const results = JSON.parse(await readFile(join(root, 'results.json'), 'utf8'));
const budget = JSON.parse(await readFile(join(root, 'budget.json'), 'utf8'));
const rows: any[] = results.rows;
const valid = rows.filter(r => !r.excludedForInputBug);
assert.equal(results.complete, true);
assert.equal(valid.length, 30);
assert.equal(new Set(rows.map(r => r.id)).size, rows.length);
assert.ok(budget.upperCny <= 9);
assert.ok(budget.accountedCny <= 10);
assert.ok(budget.entries.every((e: any) => e.status !== 'reserved'));
const trialIds = new Set(rows.map(r => r.id));
const ownEntries = budget.entries.filter((e: any) => trialIds.has(e.trial));
assert.ok(Math.abs(rows.reduce((s, r) => s + r.costUpperCny, 0) - ownEntries.reduce((s: number, e: any) => s + e.upperCny, 0)) < 1e-6);
const pairs = new Map<string, any[]>();
for (const row of valid) if (row.phase === 'warm') {
  const key = `${row.task}/${row.condition}/${row.variant}`;
  pairs.set(key, [...(pairs.get(key) ?? []), row]);
}
assert.equal(pairs.size, 12);
for (const [key, pair] of pairs) {
  assert.equal(pair.length, 2, key);
  assert.deepEqual(pair.map(r => r.arm).sort(), ['default', 'jevaction'], key);
  assert.deepEqual(pair[0].beforeLibrary, pair[1].beforeLibrary, `Action library mismatch: ${key}`);
  const traces = await Promise.all(pair.map(async row => JSON.parse(await readFile(join(root, row.traceFile), 'utf8'))));
  assert.deepEqual(traces[0].inputHashes, traces[1].inputHashes, `Input mismatch: ${key}`);
  assert.deepEqual(traces[0].expected, traces[1].expected, `Verifier target mismatch: ${key}`);
}
for (const row of rows) {
  const entries = budget.entries.filter((e: any) => e.trial === row.id);
  assert.equal(entries.filter((e: any) => e.service === 'deepseek').length, row.modelCalls);
  assert.equal(entries.filter((e: any) => e.service === 'jev').length, row.jevCalls);
  assert.equal(row.success, row.external.success && row.inputsUnchanged && row.outcome?.kind === 'completed');
}
for (const source of results.protocol.sourceTasks) {
  const text = await readFile(join(root, source.task + '.instruction.md'), 'utf8');
  assert.equal(createHash('sha256').update(text).digest('hex'), source.sha256);
}
const secrets = [process.env.DEEPSEEK_API_KEY, process.env.TYPESAFE_API_KEY].filter((v): v is string => Boolean(v && v.length > 12));
assert.equal(secrets.length, 2, 'Load .env to verify no configured credential leaked into the reports');
let scannedFiles = 0;
async function scan(dir: string) {
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    const file = join(dir, entry.name);
    if (entry.isDirectory()) await scan(file);
    else {
      const text = await readFile(file, 'utf8');
      assert.ok(!secrets.some(secret => text.includes(secret)), 'A configured credential appeared in a report');
      scannedFiles++;
    }
  }
}
await scan(root);
const audit = { auditedAt: new Date().toISOString(), validRuns: valid.length, allPaidRuns: rows.length,
  matchedPairs: pairs.size, identicalActionLibraries: true, identicalInputs: true, identicalExternalTargets: true,
  allRequestsAccounted: true, budgetUpperCny: budget.upperCny, credentialScanPassed: true, scannedFiles,
  note: 'Integrity checks of recorded experiment data; this does not rerun paid models or reconstruct final artifacts.' };
await writeFile(join(root, 'audit.json'), JSON.stringify(audit, null, 2));
console.log(JSON.stringify(audit));
