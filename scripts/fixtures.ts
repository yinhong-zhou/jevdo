import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { Store } from '../src/store.ts';
import { createAction } from '../src/learning.ts';
import { validateRecipe } from '../src/executor.ts';

export async function makeFixture(root: string, ids = ['alpha', 'beta']) {
  const store = new Store(join(root, 'store'));
  for (const id of ids) {
    const folder = join(root, id); await mkdir(folder, { recursive: true });
    const script = `import {readFile,writeFile} from 'node:fs/promises';
const name=${JSON.stringify(id)};
if(process.argv[2]==='verify') {
 const text=await readFile('artifact.txt','utf8');
 if(!text.startsWith(name+':') || !Number.isInteger(Number(text.split(':')[1]))) process.exit(2);
 console.log('VERIFIED '+text);
} else {
 let count=0; try { count=Number((await readFile('artifact.txt','utf8')).split(':')[1]); } catch {}
 await writeFile('artifact.txt',name+':'+(count+1)); console.log('BUILT '+name);
}
`;
    await writeFile(join(folder, `${id}-build.mjs`), script);
    await writeFile(join(folder, 'README.md'), `# ${id}\nA repeatable build fixture.\nBuild: node ${id}-build.mjs\nVerify: node ${id}-build.mjs verify\nThe artifact.txt file contains ${id}:<build-count>. Each requested rebuild increments it exactly once.\n`);
    await store.addProject({ id, name: id, description: `Fixture project ${id}`, aliases: [id], root: folder });
    await createAction(store, id, { actionId: 'build_artifact', description: 'Rebuild the project artifact and verify its content.', recipe: {
      id: `build-${id}-v1`, steps: [{ command: process.execPath, args: [`${id}-build.mjs`] }],
      verify: { command: { command: process.execPath, args: [`${id}-build.mjs`, 'verify'] }, contains: `VERIFIED ${id}:` },
      watchedFiles: [`${id}-build.mjs`],
    } });
    await validateRecipe(store, `build-${id}-v1`);
  }
  return store;
}
