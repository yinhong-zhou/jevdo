import { z } from 'zod';
import { readFile } from 'node:fs/promises';
import { Id, RecipeSchema } from './contracts.ts';
import { Store } from './store.ts';

export const CreateActionInput = z.object({
  actionId: Id,
  description: z.string().min(1).max(1500),
  recipe: RecipeSchema.omit({ actionId: true, projectId: true }),
}).strict();

// Authoring policy is a swappable prompt resource, never a branch in the agent loop.
export async function loadAuthoringPrompt() {
  return readFile(new URL('../prompts/action-authoring.md', import.meta.url), 'utf8');
}

export async function createAction(store: Store, projectId: string, input: unknown) {
  const value = CreateActionInput.parse(input);
  if (!(await store.projects()).some(p => p.id === projectId)) throw new Error('Register the current project first');
  const previous = (await store.actions()).find(a => a.id === value.actionId);
  if (previous && (previous.executor !== 'recipe' || previous.description !== value.description)) throw new Error('Action ID already has a different meaning; use another ID');
  if (!previous) await store.addAction({ id: value.actionId, description: value.description, executor: 'recipe',
    slots: [{ name: 'project', source: 'projects', dependsOn: [] }] });
  const recipe = await store.addRecipe({ ...value.recipe, actionId: value.actionId, projectId });
  await store.event({ kind: 'action_created', actionId: value.actionId, projectId, recipeId: recipe.id });
  return { status: 'draft', recipeId: recipe.id, next: 'Run jevaction_validate within the authorized task to make it reusable.' };
}
