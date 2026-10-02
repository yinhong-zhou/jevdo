import { z } from 'zod';
import { readFile, writeFile } from 'node:fs/promises';
import { dirname, basename, join } from 'node:path';
import type { ToolSpec } from './model.ts';
import type { ExecutionResult } from './contracts.ts';
import { Store, within } from './store.ts';
import { CommandSchema } from './contracts.ts';
import { projectFiles, runCommand, validateRecipe } from './executor.ts';
import { createAction, CreateActionInput } from './learning.ts';

type LoopTool = ToolSpec & { execute(input: unknown, signal?: AbortSignal): Promise<{
  output: string; isError?: boolean; actionResult?: ExecutionResult;
}> };

/** Optional local tools for the development DSH host. The installed plugin uses host tools. */
export async function projectTools(store: Store, projectId: string): Promise<LoopTool[]> {
  const project = (await store.projects()).find(p => p.id === projectId);
  if (!project) throw new Error('Unknown active project');
  const root = project.root;
  const define = <T extends z.ZodType>(name: string, description: string, schema: T,
    execute: (value: z.infer<T>, signal?: AbortSignal) => ReturnType<LoopTool['execute']>): LoopTool => ({
    name, description, parameters: z.toJSONSchema(schema, { io: 'input' }),
    execute: (value, signal) => execute(schema.parse(value), signal),
  });
  const pathSchema = z.object({ path: z.string().min(1) }).strict();
  return [
    define('jevaction_catalog', 'Inspect available action definitions and recipe IDs for the current project.', z.object({}).strict(), async () => ({
      output: JSON.stringify({ actions: await store.actions(), recipes: (await store.recipes()).filter(r => r.projectId === projectId) }),
    })),
    define('list_files', 'List files in the current registered project.', z.object({}).strict(), async () => ({ output: JSON.stringify(await projectFiles(project)) })),
    define('read_file', 'Read a UTF-8 file inside the current project, up to 16000 characters.', pathSchema, async ({ path }) => {
      if (basename(path).startsWith('.env')) throw new Error('Environment configuration is not exposed as a model tool');
      const text = await readFile(await within(root, path), 'utf8');
      return { output: JSON.stringify({ content: text.slice(0, 16000), truncated: text.length > 16000 }) };
    }),
    define('write_file', 'Write a UTF-8 file inside an existing directory in the current project.', pathSchema.extend({ content: z.string().max(100000) }), async ({ path, content }) => {
      if (basename(path).startsWith('.env')) throw new Error('Do not write environment configuration through a model tool');
      const parent = await within(root, dirname(path));
      const destination = join(parent, basename(path));
      try { await within(root, destination); } catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error; }
      await writeFile(destination, content);
      return { output: `Wrote ${path}` };
    }),
    define('run_command', 'Run a bounded command with explicit executable and argv in the current project. No implicit shell. Project service-control scripts may return after launching an owned background service; do not leave an unmanaged foreground server running.', CommandSchema, async (command, signal) => {
      const result = await runCommand(root, command, signal);
      return { output: JSON.stringify(result), isError: result.exitCode !== 0 };
    }),
    define('jevaction_create', 'Save a reusable operation as a draft in the current project; execution is separate.', CreateActionInput,
      async input => ({ output: JSON.stringify(await createAction(store, projectId, input)) })),
    define('jevaction_validate', 'Execute a saved draft and its verifier in the current project. On success it becomes reusable.', z.object({ recipeId: z.string() }).strict(),
      async ({ recipeId }, signal) => {
        if (!(await store.recipes()).some(r => r.id === recipeId && r.projectId === projectId)) throw new Error('Recipe is outside the active project');
        const result = await validateRecipe(store, recipeId, signal);
        return { output: JSON.stringify(result), actionResult: result };
      }),
  ];
}
