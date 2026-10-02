import type { DeveloperCase } from './developer-fixtures.ts';

/** Independent checks on explicit conversational constraints, never fed to the agent. */
export function verifyTurnRequirements(task: DeveloperCase, result: any, beforeLibrary: any, afterLibrary: any) {
  const errors: string[] = [];
  const last = result?.events?.filter((e: any) => e.type === 'assistant/message').at(-1)?.data.message;
  const finalText = last?.content?.filter((c: any) => c.type === 'text').map((c: any) => c.text).join('\n') ?? '';
  const receiptOnly = last?.source?.provider === 'jevaction-template';
  const explanation = ({ 'start-and-edit': /average/i, 'edit-generate-explain': /getOrders|orders|订单/i,
    'explain-only': /后端|backend/i, 'unknown-project': /路径|path|directory|folder|目录/i,
    'backend-failure': /refus|fail|失败|拒绝/i } as Record<string, RegExp>)[task];
  if (explanation && (receiptOnly || !explanation.test(finalText))) errors.push('Requested final explanation/question missing or replaced by raw execution receipts');
  if (['no-save','explain-only','unknown-project'].includes(task) &&
    (JSON.stringify(beforeLibrary.actions) !== JSON.stringify(afterLibrary.actions) || JSON.stringify(beforeLibrary.recipes) !== JSON.stringify(afterLibrary.recipes))) {
    errors.push('Library changed despite a no-save/no-operation request');
  }
  if (task === 'no-save' && !/v\d+\.\d+\.\d+/.test(finalText)) errors.push('Node version was not delivered');
  return { success: errors.length === 0, errors, finalText, finalSource: last?.source,
    note: 'Explanation presence is a proxy, not a semantic quality score.' };
}
