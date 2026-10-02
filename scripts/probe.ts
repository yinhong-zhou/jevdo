import { loadConfig } from '../src/config.ts';
const { decider } = await loadConfig();
try {
  const choice = await decider.choose({ purpose: 'Choose the requested operation.',
    state: { request: '列出当前目录的文件' }, candidates: [
      { id: 'list', description: 'List files in the current directory' },
      { id: 'other', description: 'Any other request' },
    ] });
  console.log(JSON.stringify({ provider: 'Jev', choice }));
} catch (error) { console.error(error instanceof Error ? error.message : String(error)); process.exitCode = 1; }
