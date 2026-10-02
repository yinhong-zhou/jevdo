import { build } from 'esbuild';
import { copyFile, mkdir } from 'node:fs/promises';
await mkdir('dist', { recursive: true });
await build({ entryPoints: ['src/dsh/index.ts'], outfile: 'dist/index.js', bundle: true,
  platform: 'node', target: 'node24', format: 'esm', packages: 'external', sourcemap: false });
console.log('Built dist/index.js (external DSH services, bundled loop and action policy).');
