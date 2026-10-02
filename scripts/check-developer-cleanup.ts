import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { ROOT } from '../src/config.ts';
let checked = 0;
for (const revision of ['v2','v3']) {
  const result = JSON.parse(await readFile(join(ROOT, `reports/developer-workflows-${revision}/results.json`),'utf8'));
  assert.ok(result.complete);
  const paths = new Set<string>(result.rows.map((r:any)=>join(ROOT,`.runtime/developer-workflows-${revision}`,r.group,
    ...(r.group === 'official-clean' ? [r.task] : []),'project')));
  for (const root of paths) for (const role of ['backend','frontend']) {
    let info: any;
    try { info = JSON.parse(await readFile(join(root,`.dev/${role}.json`),'utf8')); }
    catch(error) { if((error as NodeJS.ErrnoException).code === 'ENOENT') continue; throw error; }
    assert.equal(new URL(info.url).hostname,'127.0.0.1');
    const live = await fetch(info.url+'/health',{signal:AbortSignal.timeout(600)}).then(r=>r.ok?r.json():null).catch(()=>null) as any;
    assert.ok(!live || live.instance!==info.instance, 'An owned benchmark service remains live'); checked++;
  }
}
console.log(JSON.stringify({ownedServicesStillLive:0,descriptorsChecked:checked}));
