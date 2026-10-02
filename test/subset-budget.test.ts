import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { ExperimentBudget, tokenUpperBound, upperCost } from '../scripts/subset-budget.ts';

test('experiment budget refuses an oversized next request before spending', async () => {
  const budget = new ExperimentBudget(join(await mkdtemp(join(tmpdir(), 'jev-budget-')), 'ledger.json'));
  await assert.rejects(budget.reserve('deepseek', 5_000_000, 3000), /BUDGET_EXHAUSTED/);
  assert.equal(budget.entries.length, 0);
  assert.equal(budget.stopped, true);
});
test('unknown usage retains a reservation; reported usage settles it without cache assumptions', async () => {
  const budget = new ExperimentBudget(join(await mkdtemp(join(tmpdir(), 'jev-budget-')), 'ledger.json'));
  const first = await budget.reserve('deepseek', 10000, 3000);
  await budget.settle(first, {}, 500, 1);
  assert.equal(first.upperCny, first.reservedCny);
  const second = await budget.reserve('jev', 10000, 0);
  await budget.settle(second, { usage: { input_tokens: 1000, output_tokens: 50 } }, 200, 1);
  assert.equal(second.upperCny, upperCost('jev', 1000, 50));
  assert.ok(tokenUpperBound('中文') > '中文'.length);
});
test('observed account debit prevents a new request even when token estimates are lower', async () => {
  const budget = new ExperimentBudget(join(await mkdtemp(join(tmpdir(), 'jev-budget-')), 'ledger.json'));
  budget.observedDeepseekDebitCny = 8.99;
  await assert.rejects(budget.reserve('deepseek', 10000, 3000), /BUDGET_EXHAUSTED/);
});

test('concurrent trials retain separate attribution and reserve against one durable cap', async () => {
  const file = join(await mkdtemp(join(tmpdir(), 'jev-budget-')), 'ledger.json');
  const budget = new ExperimentBudget(file);
  await Promise.all(['a', 'b', 'c'].map(id => budget.runTrial(id, async () => {
    await new Promise(resolve => setTimeout(resolve, id === 'a' ? 8 : 1));
    const entry = await budget.reserve('deepseek', 10000, 3000);
    assert.equal(entry.trial, id);
    await budget.settle(entry, { usage: { prompt_tokens: 2000, completion_tokens: 100 } }, 200, 1);
  })));
  const saved = JSON.parse(await readFile(file, 'utf8'));
  assert.equal(saved.entries.length, 3);
  assert.ok(saved.entries.every((e: any) => e.status === 'ok'));
  assert.equal(saved.upperCny, budget.upperCny);
  budget.observedDeepseekDebitCny = 8.93;
  const reservations = await Promise.allSettled(['d', 'e', 'f'].map(id => budget.runTrial(id, () => budget.reserve('deepseek', 10000, 3000))));
  // One request reserves 0.044; a second would exceed the shared CNY 9 cap.
  assert.equal(reservations.filter(r => r.status === 'fulfilled').length, 1);
  assert.equal(budget.stopped, true);
});
