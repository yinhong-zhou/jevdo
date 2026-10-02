/** Experiment-only API cost guard. This is not a scheduling feature of the plugin. */
import { mkdir, writeFile, rename } from 'node:fs/promises';
import { dirname } from 'node:path';
import { AsyncLocalStorage } from 'node:async_hooks';

export type UsageEntry = {
  id: number; trial: string; service: 'deepseek' | 'jev'; status: string;
  reservedCny: number; upperCny: number; inputTokens?: number; outputTokens?: number;
  cacheHitTokens?: number; cacheMissTokens?: number; returnedModel?: string;
  elapsedMs?: number; error?: string;
};
export function tokenUpperBound(body: string) {
  // UTF-8 bytes exceed normal BPE token counts; allow for server-side wrappers.
  return Buffer.byteLength(body, 'utf8') + 4096;
}
export function upperCost(service: 'deepseek' | 'jev', input: number, output: number) {
  // Official Flash peak / cache-miss CNY rates. Jev: $0.042/M input,
  // conservatively charged here as CNY 0.50/M (above USD/CNY=8 conversion).
  return (service === 'deepseek' ? input * 2 + output * 8 : input * 0.5) / 1e6;
}
export class ExperimentBudget {
  entries: UsageEntry[] = [];
  trial = 'setup';
  stopped = false;
  observedDeepseekDebitCny = 0;
  readonly limitCny: number;
  private readonly trialContext = new AsyncLocalStorage<string>();
  private pendingWrite: Promise<void> = Promise.resolve();
  constructor(readonly file: string, readonly userLimitCny: number | null = 10) {
    this.limitCny = userLimitCny === null ? Infinity : Math.max(0, userLimitCny - 1);
  }
  runTrial<T>(trial: string, operation: () => Promise<T>): Promise<T> { return this.trialContext.run(trial, operation); }
  get upperCny() { return this.entries.reduce((sum, e) => sum + e.upperCny, 0); }
  get accountedCny() {
    // An observed debit cannot include charges for requests that are still reserved/in flight.
    const pendingMain = this.entries.filter(e => e.service === 'deepseek' && e.status === 'reserved').reduce((s, e) => s + e.upperCny, 0);
    return Math.max(this.entries.filter(e => e.service === 'deepseek').reduce((s, e) => s + e.upperCny, 0),
      this.observedDeepseekDebitCny + pendingMain) + this.entries.filter(e => e.service === 'jev').reduce((s, e) => s + e.upperCny, 0);
  }
  async save() {
    const snapshot = JSON.stringify({ userLimitCny: this.userLimitCny, stopLimitCny: Number.isFinite(this.limitCny) ? this.limitCny : null,
      upperCny: this.upperCny, accountedCny: this.accountedCny, stopped: this.stopped,
      observedDeepseekDebitCny: this.observedDeepseekDebitCny,
      rates: { deepseekInputPerMillionCny: 2, deepseekOutputPerMillionCny: 8, jevInputPerMillionCny: 0.5 },
      entries: this.entries }, null, 2);
    const operation = this.pendingWrite.then(async () => {
      await mkdir(dirname(this.file), { recursive: true });
      await writeFile(this.file + '.tmp', snapshot);
      await rename(this.file + '.tmp', this.file);
    });
    this.pendingWrite = operation.catch(() => undefined);
    await operation;
  }
  async reserve(service: UsageEntry['service'], inputUpper: number, maxOutput: number) {
    const cost = upperCost(service, inputUpper, maxOutput);
    if (this.stopped || this.accountedCny + cost > this.limitCny) {
      this.stopped = true; await this.save(); throw new Error('EXPERIMENT_BUDGET_EXHAUSTED');
    }
    const entry: UsageEntry = { id: this.entries.length, trial: this.trialContext.getStore() ?? this.trial, service,
      status: 'reserved', reservedCny: cost, upperCny: cost };
    this.entries.push(entry);
    // Reserve durably BEFORE the request, including requests interrupted by a crash.
    await this.save();
    return entry;
  }
  async settle(entry: UsageEntry, data: any, status: number, elapsedMs: number) {
    entry.status = status >= 200 && status < 300 ? 'ok' : `http-${status}`;
    entry.elapsedMs = elapsedMs;
    const usage = data?.usage;
    const input = entry.service === 'deepseek' ? usage?.prompt_tokens : usage?.input_tokens;
    const output = entry.service === 'deepseek' ? usage?.completion_tokens : usage?.output_tokens;
    if (Number.isFinite(input) && input >= 0 && Number.isFinite(output) && output >= 0) {
      entry.inputTokens = input; entry.outputTokens = output;
      entry.cacheHitTokens = usage?.prompt_cache_hit_tokens;
      entry.cacheMissTokens = usage?.prompt_cache_miss_tokens;
      entry.returnedModel = data.model;
      entry.upperCny = upperCost(entry.service, input, output);
      if (entry.upperCny > entry.reservedCny + 1e-9) this.stopped = true;
    } else {
      // Missing usage / ambiguous failure: keep the full reservation.
      entry.status += '-usage-unknown';
    }
    await this.save();
  }
  installTransport() {
    const original = globalThis.fetch;
    globalThis.fetch = async (input, init) => {
      const url = new URL(typeof input === 'string' || input instanceof URL ? input : input.url);
      const service = url.hostname === 'api.deepseek.com' && url.pathname.endsWith('/chat/completions') ? 'deepseek'
        : url.hostname === 'api.typesafe.ai' && url.pathname === '/v1/systemone' ? 'jev' : undefined;
      if (!service) return original(input, init);
      if (typeof init?.body !== 'string') throw new Error('Budgeted requests require a JSON body');
      const payload = JSON.parse(init.body);
      if (service === 'deepseek') {
        if (payload.model !== 'deepseek-flash') throw new Error('Unpriced model blocked');
        payload.max_tokens = Math.min(payload.max_tokens ?? 3000, 3000);
        payload.thinking = { type: 'disabled' };
        payload.temperature = 0;
      }
      const body = JSON.stringify(payload);
      const entry = await this.reserve(service, tokenUpperBound(body), service === 'deepseek' ? payload.max_tokens : 0);
      const started = Date.now();
      try {
        const response = await original(input, { ...init, body });
        const data = await response.clone().json().catch(() => null);
        await this.settle(entry, data, response.status, Date.now() - started);
        return response;
      } catch (error) {
        entry.status = 'request-error-reservation-retained';
        entry.error = error instanceof Error ? error.message : String(error);
        entry.elapsedMs = Date.now() - started;
        await this.save(); throw error;
      }
    };
    return () => { globalThis.fetch = original; };
  }
}
