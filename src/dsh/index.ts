import type { Context } from '@deepseek-ai/cordis';
import Schema from '@deepseek-ai/schemastery';
import { homedir } from 'node:os';
import { resolve } from 'node:path';
import JevAgentLoop from '../vendor/dsh-loop/index.ts';
import { Store } from '../store.ts';
import { JevDecider } from '../decision.ts';
import type { Decider } from '../contracts.ts';
import { loadAuthoringPrompt } from '../learning.ts';
import { registerActionTools, type CommandMode, type ActionRuntime } from './runtime.ts';

export const name = 'jevaction-loop';
export const inject = ['agents', 'sessions', 'llm', 'tools', 'systemPrompt', 'sessionProjections'];
export const Config = Schema.object({
  home: Schema.string().default(''), enabled: Schema.boolean().default(true),
  endpoint: Schema.string().default('https://api.typesafe.ai/v1/systemone'),
  model: Schema.string().default('jev-latest'), apiKeyEnv: Schema.string().default('TYPESAFE_API_KEY'),
  commandMode: Schema.union(['pwsh', 'bash', 'argv']).default(process.platform === 'win32' ? 'pwsh' : 'bash'),
  commandTool: Schema.string().default(''),
  agents: Schema.array(Schema.any()).default([]), maxParallelToolCalls: Schema.number().min(1).step(1).default(10),
});
export interface PluginOptions {
  home?: string; enabled?: boolean; endpoint?: string; model?: string; apiKeyEnv?: string;
  commandMode?: CommandMode; commandTool?: string; agents?: any[]; maxParallelToolCalls?: number;
}

export async function installSupport(ctx: Context, options: PluginOptions = {}, decider?: Decider) {
  const store = new Store(resolve(options.home || process.env.JEV_ACTION_HOME || resolve(homedir(), '.dsh', 'jevaction')));
  const runtime: ActionRuntime = { store, enabled: options.enabled ?? true,
    decider: decider ?? new JevDecider({ apiKey: process.env[options.apiKeyEnv || 'TYPESAFE_API_KEY'] || '',
      endpoint: options.endpoint || process.env.JEV_ENDPOINT, model: options.model || process.env.TYPESAFE_MODEL, store }),
    commandMode: options.commandMode ?? (process.platform === 'win32' ? 'pwsh' : 'bash'),
    commandTool: options.commandTool || options.commandMode || (process.platform === 'win32' ? 'pwsh' : 'bash'),
  };
  ctx.provide('jevActions', runtime);
  registerActionTools(ctx, runtime);
  ctx.systemPrompt.section({ name: 'jevaction-authoring', order: 700,
    text: await loadAuthoringPrompt(), interpolate: false });
  return runtime;
}
export async function install(ctx: Context, options: PluginOptions = {}, decider?: Decider) {
  await installSupport(ctx, options, decider);
  await ctx.plugin(JevAgentLoop, { agents: options.agents ?? [], maxParallelToolCalls: options.maxParallelToolCalls ?? 10 });
}
export async function apply(ctx: Context, options: PluginOptions) { await install(ctx, options); }
