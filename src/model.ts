import { z } from 'zod';

export type ToolCall = { id: string; type: 'function'; function: { name: string; arguments: string } };
export type Message =
  | { role: 'system' | 'user'; content: string }
  | { role: 'assistant'; content: string | null; tool_calls?: ToolCall[]; reasoning_content?: string | null }
  | { role: 'tool'; tool_call_id: string; content: string };
export type ToolSpec = { name: string; description: string; parameters: Record<string, unknown> };
export type ModelReply = {
  message: Extract<Message, { role: 'assistant' }>;
  finishReason: string;
  usage?: { inputTokens: number; outputTokens: number };
};
export interface ChatModel {
  complete(messages: Message[], tools: ToolSpec[], signal?: AbortSignal): Promise<ModelReply>;
}
const ResponseSchema = z.object({
  choices: z.array(z.object({
    finish_reason: z.string(),
    message: z.object({ role: z.literal('assistant'), content: z.string().nullable().optional(),
      reasoning_content: z.string().nullable().optional(),
      tool_calls: z.array(z.object({ id: z.string().min(1), type: z.literal('function'),
        function: z.object({ name: z.string().min(1), arguments: z.string() }) })).max(16).optional(),
    }),
  })).min(1),
  usage: z.object({ prompt_tokens: z.number().nonnegative(), completion_tokens: z.number().nonnegative() }).optional(),
});

/** Minimal OpenAI-compatible transport. The loop, not this adapter, owns execution. */
export class CompatibleChatModel implements ChatModel {
  readonly options: { model: string; baseUrl: string; apiKey: string; maxTokens?: number };
  constructor(options: CompatibleChatModel['options']) { this.options = options; }
  async complete(messages: Message[], tools: ToolSpec[], signal?: AbortSignal): Promise<ModelReply> {
    if (!this.options.apiKey) throw new Error('The main model API key is not configured');
    signal?.throwIfAborted();
    const timeout = AbortSignal.timeout(120000);
    const response = await fetch(`${this.options.baseUrl.replace(/\/$/, '')}/chat/completions`, {
      method: 'POST', headers: { Authorization: `Bearer ${this.options.apiKey}`, 'Content-Type': 'application/json' },
      signal: signal ? AbortSignal.any([signal, timeout]) : timeout,
      body: JSON.stringify({ model: this.options.model, messages, stream: false, max_tokens: this.options.maxTokens ?? 4096,
        ...(tools.length ? { tools: tools.map(t => ({ type: 'function', function: t })), tool_choice: 'auto' } : {}) }),
    });
    if (!response.ok) throw new Error(`Main model HTTP ${response.status}`);
    const data = ResponseSchema.parse(await response.json());
    const selected = data.choices[0];
    const calls = selected.message.tool_calls;
    if (calls && new Set(calls.map(c => c.id)).size !== calls.length) throw new Error('Duplicate tool call IDs');
    return {
      message: { ...selected.message, content: selected.message.content ?? null }, finishReason: selected.finish_reason,
      ...(data.usage ? { usage: { inputTokens: data.usage.prompt_tokens, outputTokens: data.usage.completion_tokens } } : {}),
    };
  }
}
