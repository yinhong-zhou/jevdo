import assert from 'node:assert/strict';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { dirname, join, resolve, relative, isAbsolute, sep } from 'node:path';
import { createHash } from 'node:crypto';
import { ROOT } from '../src/config.ts';

export async function captureSources(reportDir: string, hashes: Record<string, string>) {
  for (const [path, expected] of Object.entries(hashes)) {
    const source = resolve(ROOT, path), rel = relative(ROOT, source);
    assert.ok(rel && rel !== '..' && !rel.startsWith(`..${sep}`) && !isAbsolute(rel));
    const bytes = await readFile(source);
    assert.equal(createHash('sha256').update(bytes).digest('hex'), expected, `Source differs before snapshot: ${path}`);
    const target = join(reportDir, 'source', rel);
    await mkdir(dirname(target), { recursive: true });
    try { await writeFile(target, bytes, { flag: 'wx' }); }
    catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error;
      assert.deepEqual(await readFile(target), bytes, 'Existing source snapshot differs');
    }
  }
}

if (process.argv[2] === '--previous-developer') {
  const reportDir = join(ROOT, 'reports/developer-workflows');
  const protocol = JSON.parse(await readFile(join(reportDir, 'protocol.json'), 'utf8'));
  await captureSources(reportDir, protocol.sourceHashes);
  console.log('Historical developer experiment sources verified and captured.');
}
