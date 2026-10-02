import type { Choice, ChoiceRequest, Decider } from './contracts.ts';
import type { Store } from './store.ts';

export type JevOptions = {
  apiKey: string; endpoint?: string; model?: string; store?: Store;
  onPayload?: (payload: unknown) => Promise<unknown> | unknown;
  onResponse?: (response: Response) => Promise<void> | void;
};

export function validateChoice(raw: unknown, ids: string[]): Choice {
  if (!raw || typeof raw !== 'object') throw new Error('Missing Jev choice');
  const value = raw as Record<string, unknown>;
  const probabilities = value.probabilities;
  if (typeof value.choice !== 'string' || !ids.includes(value.choice) ||
      typeof value.confidence !== 'number' || !Number.isFinite(value.confidence) ||
      value.confidence < 0 || value.confidence > 1 || !probabilities || typeof probabilities !== 'object') {
    throw new Error('Invalid Jev choice');
  }
  const distribution = probabilities as Record<string, unknown>;
  const numbers = Object.values(distribution);
  if (Object.keys(distribution).sort().join('\0') !== [...ids].sort().join('\0') ||
      numbers.some(n => typeof n !== 'number' || !Number.isFinite(n) || n < 0 || n > 1)) throw new Error('Invalid Jev distribution');
  const values = numbers as number[];
  if (Math.abs(values.reduce((a,b) => a+b, 0) - 1) > 0.02 ||
      (distribution[value.choice] as number) < Math.max(...values) - 1e-6) throw new Error('Inconsistent Jev distribution');
  return { id: value.choice, confidence: value.confidence };
}

export class JevDecider implements Decider {
  readonly options: JevOptions;
  calls = 0;
  elapsedMs = 0;
  observations: { ok: boolean; elapsedMs: number; usage: unknown; error?: string }[] = [];
  constructor(options: JevOptions) { this.options = options; }
  async choose(request: ChoiceRequest, signal?: AbortSignal): Promise<Choice> {
    if (!this.options.apiKey) throw new Error('TYPESAFE_API_KEY is not configured');
    if (request.candidates.length === 0 || request.candidates.length > 200) throw new Error('Candidate count outside request budget');
    const started = Date.now();
    const payload = {
      model: this.options.model ?? 'jev-latest', state: request.state,
      questions: { decision: { type: 'choice', instructions: request.purpose,
        criteria: Object.fromEntries(request.candidates.map(c => [c.id, JSON.stringify({ description: c.description, ...c.metadata })])) } },
    };
    const replacement = await this.options.onPayload?.(payload);
    const body = JSON.stringify(replacement ?? payload);
    const timeout = AbortSignal.timeout(25000);
    this.calls++;
    let usage: unknown = null;
    try {
    const response = await fetch(this.options.endpoint ?? 'https://api.typesafe.ai/v1/systemone', {
      method: 'POST', headers: { Authorization: `Bearer ${this.options.apiKey}`, 'Content-Type': 'application/json' },
      body, signal: signal ? AbortSignal.any([signal, timeout]) : timeout,
    });
    await this.options.onResponse?.(response);
    if (!response.ok) throw new Error(`Jev HTTP ${response.status}`);
    const data = await response.json() as { answers?: { decision?: unknown }; usage?: unknown };
    usage = data.usage ?? null;
    // Persist the unmodified answer BEFORE validation, including rejected answers.
    await this.options.store?.event({ kind: 'jev_decision_raw', sessionId: request.state.sessionId,
      stage: request.state.stage, candidates: request.candidates.map(c => c.id), answer: data.answers?.decision ?? null, usage });
    const choice = validateChoice(data.answers?.decision, request.candidates.map(c => c.id));
    const elapsedMs = Date.now() - started;
    this.elapsedMs += elapsedMs;
    this.observations.push({ ok: true, elapsedMs, usage });
    await this.options.store?.event({ kind: 'jev_decision', sessionId: request.state.sessionId, selected: choice.id, confidence: choice.confidence,
      candidates: request.candidates.length, elapsedMs, usage });
    return choice;
    } catch (error) {
      const elapsedMs = Date.now() - started;
      this.elapsedMs += elapsedMs;
      const observation = { ok: false, elapsedMs, usage, error: error instanceof Error ? error.message : String(error) };
      this.observations.push(observation);
      await this.options.store?.event({ kind: 'jev_decision_failed', sessionId: request.state.sessionId, stage: request.state.stage, ...observation });
      throw error;
    }
  }
}

/** Strict literal baseline for ablations; never silently substituted for Jev. */
export class LiteralDecider implements Decider {
  async choose(request: ChoiceRequest): Promise<Choice> {
    const text = String(request.state.request ?? '').toLowerCase();
    let id: string | undefined;
    if (request.state.stage === 'action') {
      const completed = request.state.completedActionIds as string[] | undefined;
      if (completed?.length && request.candidates.some(c => c.id === 'DONE')) id = 'DONE';
      else id = request.candidates.find(c => c.id === 'list_files' && /list files|列出文件|列目录/.test(text))?.id
        ?? request.candidates.find(c => c.id === 'read_file' && /read |读取|读一下/.test(text))?.id
        ?? request.candidates.find(c => text.includes(c.id))?.id;
    } else {
      const matches = request.candidates.filter(c => c.metadata && [c.id, ...(c.metadata.aliases as string[] ?? [])]
        .some(alias => alias && text.includes(alias.toLowerCase())));
      if (matches.length === 1) id = matches[0].id;
      else if (matches.length === 0) id = request.candidates.find(c => c.metadata?.active === true)?.id;
    }
    return { id: id ?? (request.candidates.some(c => c.id === 'LLM') ? 'LLM' : 'ASK'), confidence: 1 };
  }
}
