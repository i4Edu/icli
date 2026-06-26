#!/usr/bin/env node
import { mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';

function parseOutDir(argv) {
  const outIndex = argv.indexOf('--out');
  if (outIndex === -1) return './completions';

  const outDir = argv[outIndex + 1];
  if (!outDir || outDir.startsWith('--')) {
    throw new Error('Expected a directory after --out');
  }
  return outDir;
}

async function loadCompletionModule() {
  try {
    return await import('../dist/util/completion.js');
  } catch (error) {
    const cause = error instanceof Error ? `\n${error.message}` : '';
    throw new Error(`Unable to load dist/util/completion.js. Run \`npm run build\` before generating completions.${cause}`);
  }
}

const outDir = resolve(process.cwd(), parseOutDir(process.argv.slice(2)));
const completion = await loadCompletionModule();

await mkdir(outDir, { recursive: true });

const files = [
  ['icopilot.bash', completion.bashCompletion()],
  ['_icopilot', completion.zshCompletion()],
  ['icopilot.ps1', completion.pwshCompletion()],
];

await Promise.all(files.map(([name, content]) => writeFile(resolve(outDir, name), content, 'utf8')));

console.log(`Generated ${files.length} completion scripts in ${outDir}:`);
for (const [name] of files) {
  console.log(`- ${name}`);
}
