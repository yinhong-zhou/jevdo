import { resolve } from 'node:path';
import type { Agent } from '@deepseek-ai/dsh-agent';
import type { Command, Project, Recipe } from '../contracts.ts';

export type ObservedExecution = { callIds: string[]; output: string };
type MatchCommand = (toolName: string, args: any, command: Command) => boolean;

/** Only reuse actual tool results in this user request, never the model's claim. */
export function findObservedExecution(agent: Agent, project: Project, recipe: Recipe, match: MatchCommand):
  { evidence?: ObservedExecution; alreadyAttempted: boolean } {
  const all = agent.session.snapshotEvents();
  const from = all.findLastIndex(e => e.type === 'user/message' && e.data.source.kind === 'user');
  const events = all.slice(from + 1);
  let index = 0, callIds: string[] = [], outputs: string[] = [], alreadyAttempted = false;
  const clear = () => { index = 0; callIds = []; outputs = []; };
  for (const event of events) {
    if (event.type !== 'tool/call') continue;
    const call = event.data;
    if (['read_file', 'list_files', 'jevaction_catalog', 'jevaction_create', 'jevaction_validate'].includes(call.name)) continue;
    let args: any;
    try { args = typeof call.arguments === 'string' ? JSON.parse(call.arguments) : call.arguments; }
    catch { clear(); continue; }
    if (recipe.steps.some(step => match(call.name, args, step))) alreadyAttempted = true;
    const result = events.find(e => e.type === 'tool/result' && e.data.message.toolCallId === call.callId);
    let output: any;
    try {
      if (result?.type !== 'tool/result' || result.data.message.isError) { clear(); continue; }
      output = JSON.parse(result.data.message.content.filter(c => c.type === 'text').map(c => c.text).join('\n'));
    } catch { clear(); continue; }
    const success = output?.exitCode === 0 && !output.timedOut && !output.aborted && !output.stopped && (!output.kind || output.kind === 'foreground');
    if (success && index < recipe.steps.length && match(call.name, args, recipe.steps[index])) {
      callIds.push(String(call.callId)); outputs.push(String(output.output ?? output.stdout?.text ?? '')); index++;
    } else if (success && index === recipe.steps.length && match(call.name, args, recipe.verify.command)) {
      // A documented verifier may run between the effect and saving the recipe.
    } else {
      clear();
      if (success && match(call.name, args, recipe.steps[0])) {
        callIds.push(String(call.callId)); outputs.push(String(output.output ?? output.stdout?.text ?? '')); index = 1;
      }
    }
  }
  return { alreadyAttempted, ...(index === recipe.steps.length ? { evidence: { callIds, output: outputs.join('\n') } } : {}) };
}

export function sameArgvCommand(project: Project, args: any, command: Command) {
  return args?.command === command.command && JSON.stringify(args.args ?? []) === JSON.stringify(command.args)
    && resolve(project.root, args.cwd ?? '.') === resolve(project.root, command.cwd);
}

export function plainCommand(command: Command) {
  const tokens = [command.command, ...command.args];
  // Only literal unquoted words. Never parse operators, expansions or chained shell code.
  return tokens.every(t => /^[a-zA-Z0-9_./:\\=+-]+$/.test(t)) ? tokens.join(' ') : undefined;
}
