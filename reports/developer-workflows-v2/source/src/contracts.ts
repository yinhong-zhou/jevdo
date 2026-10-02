import { z } from 'zod';

export const Id = z.string().regex(/^[a-z][a-z0-9_-]{0,63}$/);
export const ProjectSchema = z.object({
  id: Id, name: z.string().min(1).max(200), description: z.string().max(1000),
  aliases: z.array(z.string().max(100)).max(20).default([]), root: z.string().min(1),
}).strict();
export const SlotSchema = z.object({
  name: Id, source: z.enum(['projects', 'files']), dependsOn: z.array(Id).default([]),
}).strict();
export const ActionSchema = z.object({
  id: Id, description: z.string().min(1).max(1500),
  slots: z.array(SlotSchema).max(4), executor: z.enum(['recipe', 'list', 'read']),
}).strict();
export const CommandSchema = z.object({
  command: z.string().min(1).max(1000), args: z.array(z.string().max(8000)).max(50).default([]),
  cwd: z.string().default('.'), timeoutMs: z.number().int().min(100).max(120000).default(30000),
}).strict();
export const RecipeSchema = z.object({
  id: Id, actionId: Id, projectId: Id,
  steps: z.array(CommandSchema).min(1).max(12),
  verify: z.object({ command: CommandSchema, contains: z.string().min(1).max(1000) }).strict(),
  watchedFiles: z.array(z.string().min(1)).max(30).describe('Implementation dependencies whose change requires review: execution/verification scripts and command definitions. NOT ordinary inputs: tested source code, schema consumed by a generator, report data, or outputs. May be empty for a direct command with no project implementation files.'),
  repeatPolicy: z.enum(['once_per_request', 'if_not_satisfied']).optional().describe('Use if_not_satisfied for safely repeatable state operations: tests, build, generate, ensure service started/stopped. An earlier receipt is rechecked and the operation reruns if its verifier no longer passes. Use once_per_request for publication or other effects that must not be repeated automatically; this is the default.'),
}).strict();
export const ReceiptSchema = z.object({
  recipeId: Id, fingerprint: z.string(), verifiedAt: z.string(), executionId: z.string(),
}).strict();
export type Project = z.infer<typeof ProjectSchema>;
export type Action = z.infer<typeof ActionSchema>;
export type Command = z.infer<typeof CommandSchema>;
export type Recipe = z.infer<typeof RecipeSchema>;
export type Receipt = z.infer<typeof ReceiptSchema>;
export type Candidate = { id: string; description: string; metadata?: Record<string, unknown> };
export type ChoiceRequest = { purpose: string; state: Record<string, unknown>; candidates: Candidate[] };
export type Choice = { id: string; confidence: number };
export interface Decider { choose(request: ChoiceRequest, signal?: AbortSignal): Promise<Choice> }
export type DecisionContext = {
  request: string; activeProject?: string; recent?: string[]; results?: ExecutionResult[]; sessionId?: string;
  modelInput?: { messages: unknown; tools: unknown; toolHistory?: unknown };
};
export type ActionPlan = {
  kind: 'action'; actionId: string; projectId: string; file?: string;
  recipeId?: string; fingerprint?: string;
};
export type Plan = ActionPlan | { kind: 'llm' | 'ask' | 'done'; reason: string };
export type CommandResult = { exitCode: number | null; output: string; truncated: boolean };
export type ExecutionResult = {
  id: string; actionId: string; projectId: string; status: 'verified' | 'failed';
  output: string; elapsedMs: number; fingerprint?: string; error?: string;
};
export type ModelOption = {
  id: string; model: string; baseUrl: string; apiKeyEnv: string; description: string;
  capabilities: string[]; contextWindow: number;
};
export const BUILTINS: Action[] = [
  { id: 'list_files', description: 'List the files in a registered project. No modification.', executor: 'list',
    slots: [{ name: 'project', source: 'projects', dependsOn: [] }] },
  { id: 'read_file', description: 'Read a file from a registered project. No modification.', executor: 'read',
    slots: [{ name: 'project', source: 'projects', dependsOn: [] },
      { name: 'file', source: 'files', dependsOn: ['project'] }] },
];
