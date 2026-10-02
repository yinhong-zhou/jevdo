import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';
import { z } from 'zod';
import { Store } from './store.ts';
import { Id } from './contracts.ts';
import { JevDecider } from './decision.ts';

export const ROOT = fileURLToPath(new URL('../', import.meta.url));
const Models = z.array(z.object({ id: Id, model: z.string().min(1), baseUrl: z.url(), apiKeyEnv: z.string().regex(/^[A-Z][A-Z0-9_]*$/),
  description: z.string(), capabilities: z.array(z.string()), contextWindow: z.number().int().positive() }).strict()).min(1);
export async function loadConfig() {
  const models = Models.parse(JSON.parse(await readFile(resolve(ROOT, 'config/models.json'), 'utf8')));
  if (new Set(models.map(m => m.id)).size !== models.length) throw new Error('Model IDs must be unique');
  for (const model of models) if (model.id === 'deepseek') {
    model.model = process.env.DEEPSEEK_MODEL || model.model;
    model.baseUrl = process.env.DEEPSEEK_BASE_URL || model.baseUrl;
  }
  const store = new Store(resolve(ROOT, process.env.JEV_ACTION_HOME || '.jevaction'));
  const options = { apiKey: process.env.TYPESAFE_API_KEY || '',
    endpoint: process.env.JEV_ENDPOINT || undefined, model: process.env.TYPESAFE_MODEL || 'jev-latest', store };
  return { models, store, options, decider: new JevDecider(options), fixedModel: process.env.JEV_FIXED_MODEL || undefined };
}
