import { mkdir, readFile, readdir, realpath, writeFile, appendFile, link, unlink } from 'node:fs/promises';
import { isAbsolute, join, relative, resolve, sep } from 'node:path';
import { createHash, randomUUID } from 'node:crypto';
import { z } from 'zod';
import { Id, ProjectSchema, ActionSchema, RecipeSchema, ReceiptSchema, BUILTINS } from './contracts.ts';
import type { Recipe, Project, Receipt } from './contracts.ts';

export async function within(root: string, path = '.'): Promise<string> {
  const base = await realpath(root);
  const target = await realpath(resolve(base, path));
  const rel = relative(base, target);
  if (rel === '..' || rel.startsWith(`..${sep}`) || isAbsolute(rel)) throw new Error('Path leaves project scope');
  return target;
}

export class Store {
  readonly home: string;
  constructor(home: string) { this.home = resolve(home); }
  private async save<T>(group: string, id: string, value: T) {
    Id.parse(id);
    await mkdir(join(this.home, group), { recursive: true });
    // Publish a complete immutable record without overwriting a concurrent ID.
    const temporary = join(this.home, group, `.${id}-${randomUUID()}.tmp`);
    await writeFile(temporary, JSON.stringify(value, null, 2), { flag: 'wx' });
    try { await link(temporary, join(this.home, group, `${id}.json`)); }
    finally { await unlink(temporary); }
    return value;
  }
  private async all<T>(group: string, schema: z.ZodType<T>): Promise<T[]> {
    const folder = join(this.home, group);
    let files: string[];
    try { files = await readdir(folder); } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return [];
      throw error;
    }
    return Promise.all(files.filter(f => f.endsWith('.json')).sort().map(async file =>
      schema.parse(JSON.parse(await readFile(join(folder, file), 'utf8')))));
  }
  projects() { return this.all('projects', ProjectSchema); }
  async actions() { return [...BUILTINS, ...await this.all('actions', ActionSchema)]; }
  recipes() { return this.all('recipes', RecipeSchema); }
  receipts() { return this.all('receipts', ReceiptSchema); }
  async activeRecipe(actionId: string, projectId: string) {
    const recipes = (await this.recipes()).filter(r => r.actionId === actionId && r.projectId === projectId);
    const receipts = (await this.receipts()).filter(r => recipes.some(recipe => recipe.id === r.recipeId))
      .sort((a, b) => b.verifiedAt.localeCompare(a.verifiedAt));
    if (!receipts.length) return undefined;
    // An ambiguous concurrent activation must be resolved explicitly, never by directory enumeration order.
    if (receipts[1]?.verifiedAt === receipts[0].verifiedAt && receipts[1].recipeId !== receipts[0].recipeId) return undefined;
    return recipes.find(r => r.id === receipts[0].recipeId);
  }
  async addProject(input: unknown) {
    const project = ProjectSchema.parse(input);
    project.root = await realpath(project.root);
    return this.save('projects', project.id, project);
  }
  async addAction(input: unknown) {
    const action = ActionSchema.parse(input);
    if (BUILTINS.some(b => b.id === action.id)) throw new Error('Built-in action IDs are reserved');
    if (action.executor !== 'recipe' || JSON.stringify(action.slots) !== JSON.stringify([
      { name: 'project', source: 'projects', dependsOn: [] },
    ])) throw new Error('Learned actions currently require one project slot and a recipe executor');
    return this.save('actions', action.id, action);
  }
  async addRecipe(input: unknown) {
    const recipe = RecipeSchema.parse(input);
    if (!(await this.actions()).some(a => a.id === recipe.actionId && a.executor === 'recipe')) throw new Error('Unknown learned action');
    const project = (await this.projects()).find(p => p.id === recipe.projectId);
    if (!project) throw new Error('Unknown project');
    for (const file of recipe.watchedFiles) await within(project.root, file);
    for (const command of [...recipe.steps, recipe.verify.command]) await within(project.root, command.cwd);
    return this.save('recipes', recipe.id, recipe);
  }
  async recordReceipt(receipt: Receipt) {
    return this.save('receipts', `r-${randomUUID()}`, ReceiptSchema.parse(receipt));
  }
  async event(event: Record<string, unknown>) {
    await mkdir(this.home, { recursive: true });
    // Event metadata deliberately excludes API credentials, prompts and full tool logs.
    await appendFile(join(this.home, 'events.jsonl'), `${JSON.stringify({ at: new Date().toISOString(), ...event })}\n`);
  }
}

export async function fingerprint(project: Project, recipe: Recipe) {
  const hash = createHash('sha256').update(JSON.stringify({ project, recipe }));
  for (const file of recipe.watchedFiles) {
    hash.update(file).update(await readFile(await within(project.root, file)));
  }
  return hash.digest('hex');
}

export async function readiness(store: Store, project: Project, recipe: Recipe) {
  const current = await fingerprint(project, recipe);
  const ready = (await store.receipts()).some(r => r.recipeId === recipe.id && r.fingerprint === current);
  return { fingerprint: current, ready };
}
