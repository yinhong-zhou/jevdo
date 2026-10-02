import { mkdir, writeFile, readFile, readdir, unlink } from 'node:fs/promises';
import { join } from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import assert from 'node:assert/strict';

const exec = promisify(execFile);
export const UPSTREAM = 'https://github.com/harbor-framework/terminal-bench-2-1';
export const REVISION = '7131e4375048a0e408a8fb404b5f499d726b695b';
export const TASKS = ['log-summary-date-ranges', 'multi-source-data-merger', 'regex-log'] as const;
export type Task = typeof TASKS[number];
export const PYTHON = 'C:/ProgramData/anaconda3/python.exe';
export async function python(code: string, args: string[] = []) {
  const result = await exec(PYTHON, ['-c', code, ...args], { timeout: 30000, maxBuffer: 1e6, windowsHide: true });
  return result.stdout.trim();
}
export async function sourceInstructions(task: Task) {
  const url = `https://raw.githubusercontent.com/harbor-framework/terminal-bench-2-1/${REVISION}/tasks/${task}/instruction.md`;
  const response = await fetch(url);
  if (!response.ok) throw new Error(`Upstream instruction ${response.status}`);
  return { url, instruction: await response.text() };
}
export async function setupProject(root: string, task: Task, instruction: string) {
  await mkdir(root, { recursive: true });
  const adaptation = task === 'log-summary-date-ranges'
    ? 'Use ./logs and write ./summary.csv. The current reference date is read from reference_date.txt (variable task input) instead of being hardcoded. All other period, severity and CSV ordering requirements apply. Each event line contains exactly one severity token.'
    : task === 'multi-source-data-merger'
      ? 'Use ./data/source_a/users.json, ./data/source_b/users.csv, ./data/source_c/users.parquet. Write ./merged_users.parquet and ./conflicts.json. Input dates use YYYY-MM-DD. All source fields have nonempty strings; a missing optional status field is absent, not a conflict. Report one conflict for each (user_id, normalized field) with two or more distinct present source values. Sort output users by user_id. Conflict ordering does not matter.'
      : 'Write ./regex.txt preserving the original Python re.MULTILINE semantics. Also apply this regex to ./log.txt and write the resulting list of matching date strings to ./matches.json. Each input event occupies one line. Regenerate matches.json whenever log.txt changes. Dates have four-digit years, calendar-valid month/day (February allows 29 in all years), and the original boundary rules apply.';
  await writeFile(join(root, 'README.md'), `# ${task}\n\n${instruction}\n\n## Local evaluation adaptation\n${adaptation}\n\n## Runtime\nThis is Windows. Python is ${PYTHON}; pandas and pyarrow are installed. Node is available as node. Use relative workspace paths, not /app or /data. UTF-8 data. You may create implementation scripts and your own checks. No implementation, expected outputs or benchmark checker are provided.\n`);
  await prepareVariant(root, task, 0);
}
type Expected = { kind: Task; [key: string]: any };
export async function prepareVariant(root: string, task: Task, variant: number): Promise<Expected> {
  const outputs = task === TASKS[0] ? ['summary.csv'] : task === TASKS[1] ? ['merged_users.parquet', 'conflicts.json'] : ['matches.json'];
  for (const file of outputs) await unlink(join(root, file)).catch((e: NodeJS.ErrnoException) => { if (e.code !== 'ENOENT') throw e; });
  if (task === TASKS[0]) {
    const logs = join(root, 'logs'); await mkdir(logs, { recursive: true });
    for (const file of await readdir(logs)) await unlink(join(logs, file));
    const reference = ['2025-08-12', '2025-08-12', '2025-09-03'][variant]!;
    await writeFile(join(root, 'reference_date.txt'), reference + '\n');
    const referenceMs = Date.parse(reference + 'T00:00:00Z');
    const buckets: Record<string, number[]> = Object.fromEntries(['today', 'last_7_days', 'last_30_days', 'month_to_date', 'total'].map(p => [p, [0, 0, 0]]));
    for (const [i, days] of [-1, 0, 1, 6, 7, 11, 12, 29, 30, 70].entries()) {
      const date = new Date(referenceMs - days * 86400000).toISOString().slice(0, 10);
      const counts = [(i + variant * 2) % 5, (i * 2 + variant + 1) % 4, (i + variant + 2) % 6];
      const periods = ['total'];
      if (days === 0) periods.push('today');
      if (days >= 0 && days <= 6) periods.push('last_7_days');
      if (days >= 0 && days <= 29) periods.push('last_30_days');
      if (days >= 0 && date.slice(0, 7) === reference.slice(0, 7)) periods.push('month_to_date');
      for (const period of periods) counts.forEach((count, j) => { buckets[period]![j]! += count; });
      const text = counts.flatMap((n, j) => Array.from({ length: n }, (_, k) => `[${['ERROR', 'WARNING', 'INFO'][j]} event-${i}-${k}`)).join('\n');
      await writeFile(join(logs, `${date}_${i % 2 ? 'web' : 'db'}.log`), text ? text + '\n' : '');
    }
    return { kind: task, buckets };
  }
  if (task === TASKS[1]) {
    const a = [
      { user_id: 1 + variant * 10, full_name: `Alpha ${variant}`, email: `a${variant}@example.test`, registration_date: '2025-01-02', status: 'active' },
      { user_id: 2 + variant * 10, full_name: `Beta, ${variant}`, email: `b${variant}@example.test`, registration_date: '2025-02-03', status: 'pending' },
    ];
    const b = [
      { id: 1 + variant * 10, name: `Old Alpha ${variant}`, email_address: `a${variant}@example.test`, created_at: '2024-12-01' },
      { id: 3 + variant * 10, name: `Gamma ${variant}`, email_address: `g${variant}@example.test`, created_at: '2025-03-04' },
    ];
    const c = [
      { userId: 1 + variant * 10, userName: `Alpha ${variant}`, email: `legacy${variant}@example.test`, joined: '2025-01-02' },
      { userId: 3 + variant * 10, userName: `Gamma ${variant}`, email: `g${variant}@example.test`, joined: '2025-03-04' },
      { userId: 4 + variant * 10, userName: `Delta ${variant}`, email: `d${variant}@example.test`, joined: '2025-04-05' },
    ];
    if (variant === 2) b.push({ id: 2 + variant * 10, name: 'Changed Beta', email_address: 'new@example.test', created_at: '2025-02-03' });
    for (const source of ['source_a', 'source_b', 'source_c']) await mkdir(join(root, 'data', source), { recursive: true });
    await writeFile(join(root, 'data/source_a/users.json'), JSON.stringify(a, null, 2));
    await python('import sys,json,pandas as pd\nroot,b,c=sys.argv[1],json.loads(sys.argv[2]),json.loads(sys.argv[3])\npd.DataFrame(b).to_csv(root+"/data/source_b/users.csv",index=False)\npd.DataFrame(c).to_parquet(root+"/data/source_c/users.parquet",index=False)', [root, JSON.stringify(b), JSON.stringify(c)]);
    const normalized = [a.map(r => ({ user_id: r.user_id, name: r.full_name, email: r.email, created_date: r.registration_date, status: r.status })),
      b.map(r => ({ user_id: r.id, name: r.name, email: r.email_address, created_date: r.created_at })),
      c.map(r => ({ user_id: r.userId, name: r.userName, email: r.email, created_date: r.joined }))] as Record<string, any>[][];
    const users: any[] = []; const conflicts: any[] = [];
    const ids = [...new Set(normalized.flat().map(r => r.user_id))].sort((x, y) => x - y);
    for (const id of ids) {
      const rows = normalized.map(list => list.find(r => r.user_id === id)); const user: any = { user_id: id };
      for (const field of ['name', 'email', 'created_date', 'status']) {
        const values = Object.fromEntries(rows.map((r, i) => [`source_${'abc'[i]}`, r?.[field]]).filter(([, v]) => v !== undefined));
        const ordered = Object.values(values); if (!ordered.length) continue;
        user[field] = ordered[0];
        if (new Set(ordered).size > 1) conflicts.push({ user_id: id, field, values, selected: ordered[0] });
      }
      users.push(user);
    }
    return { kind: task, users, conflicts };
  }
  const dates = [['2025-02-29', '2025-12-31'], ['2026-04-30', '2026-02-29'], ['2027-01-01', '2027-11-30']][variant]!;
  const lines: [string, string | null][] = [
    [`host 192.168.1.1 date ${dates[0]}`, dates[0]!],
    [`start 2020-01-01 ip=8.8.8.8 finished ${dates[1]}`, dates[1]!],
    [`${dates[0]} ... endpoint 255.255.255.255`, dates[0]!],
    [`host 01.2.3.4 date ${dates[0]}`, null],
    [`host 256.2.3.4 date ${dates[1]}`, null],
    [`no network date ${dates[0]}`, null],
    [`abc192.168.1.1 date ${dates[0]}`, null],
    ['host 127.0.0.1 invalid 2025-04-31 and 2025-02-30', null],
    [`host 0.0.0.0 valid ${dates[0]} then invalid 2025-13-01`, dates[0]!],
    ['host 1.2.3.4 user 1134-12-1234 and x2025-01-01', null],
    [`(${dates[1]}) host [10.0.0.2]`, dates[1]!],
    [`host 8.8.4.4 x${dates[0]}y`, null],
  ];
  if (variant === 2) lines.push([`host 1.1.1.1 date ${dates[0]} then ${dates[1]}`, dates[1]!]);
  await writeFile(join(root, 'log.txt'), lines.map(([line]) => line).join('\n') + '\n');
  return { kind: task, matches: lines.map(([, match]) => match).filter(x => x !== null) };
}
export async function verifyProject(root: string, expected: Expected) {
  try {
    if (expected.kind === TASKS[0]) {
      const lines = (await readFile(join(root, 'summary.csv'), 'utf8')).replace(/^\uFEFF/, '').trim().split(/\r?\n/);
      const wanted = ['period,severity,count', ...Object.entries(expected.buckets).flatMap(([p, counts]) => (counts as number[]).map((n, i) => `${p},${['ERROR', 'WARNING', 'INFO'][i]},${n}`))];
      assert.deepEqual(lines, wanted);
    } else if (expected.kind === TASKS[1]) {
      const actual = JSON.parse(await python('import sys,json,pandas as pd\ndf=pd.read_parquet(sys.argv[1]+"/merged_users.parquet")\nassert pd.api.types.is_integer_dtype(df["user_id"])\nprint(df.to_json(orient="records"))', [root]));
      const clean = (rows: any[]) => rows.map(r => Object.fromEntries(Object.entries(r).filter(([, v]) => v !== null && v !== undefined))).sort((a, b) => Number(a.user_id) - Number(b.user_id));
      assert.deepEqual(clean(actual), clean(expected.users));
      const conflicts = JSON.parse(await readFile(join(root, 'conflicts.json'), 'utf8'));
      assert.equal(conflicts.total_conflicts, expected.conflicts.length);
      const sort = (rows: any[]) => [...rows].sort((a, b) => a.user_id - b.user_id || a.field.localeCompare(b.field));
      assert.deepEqual(sort(conflicts.conflicts), sort(expected.conflicts));
    } else {
      assert.deepEqual(JSON.parse(await readFile(join(root, 'matches.json'), 'utf8')), expected.matches);
      const applied = JSON.parse(await python('import re,sys,json,pathlib\np=pathlib.Path(sys.argv[1])\npattern=(p/"regex.txt").read_text(encoding="utf-8").strip()\nprint(json.dumps(re.findall(pattern,(p/"log.txt").read_text(encoding="utf-8"),re.MULTILINE)))', [root]));
      assert.deepEqual(applied, expected.matches);
    }
    return { success: true, error: null };
  } catch (error) { return { success: false, error: String(error).slice(0, 4000) }; }
}
