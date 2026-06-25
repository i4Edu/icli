#!/usr/bin/env node
import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';

const bin = 'bin/icopilot.js';
let failures = 0;

function check(name, fn) {
  try {
    fn();
    console.log(`  ✔ ${name}`);
  } catch (err) {
    failures++;
    console.error(`  ✗ ${name}: ${err.message}`);
  }
}

if (!existsSync(bin)) {
  console.error(`error: ${bin} not found — run \`npm run build\` first.`);
  process.exit(1);
}

console.log(`smoke: ${bin}`);

check('--help exits 0 and mentions iCopilot', () => {
  const r = spawnSync('node', [bin, '--help'], { encoding: 'utf8' });
  if (r.status !== 0) throw new Error(`exit ${r.status}`);
  if (!/iCopilot/i.test(r.stdout)) throw new Error('missing iCopilot in help');
});

check('--version prints semver', () => {
  const r = spawnSync('node', [bin, '--version'], { encoding: 'utf8' });
  if (r.status !== 0) throw new Error(`exit ${r.status}`);
  if (!/\d+\.\d+\.\d+/.test(r.stdout)) throw new Error(`bad version: ${r.stdout}`);
});

check('rejects missing GITHUB_TOKEN with helpful message', () => {
  const env = { ...process.env };
  delete env.GITHUB_TOKEN;
  delete env.ICOPILOT_TOKEN;
  const r = spawnSync('node', [bin, '-p', 'hello'], { encoding: 'utf8', env });
  if (r.status === 0) throw new Error('expected non-zero exit');
  const out = (r.stderr || '') + (r.stdout || '');
  if (!/GITHUB_TOKEN/i.test(out)) throw new Error(`missing GITHUB_TOKEN hint in: ${out}`);
});

if (failures) {
  console.error(`\n${failures} smoke check(s) failed.`);
  process.exit(1);
}
console.log('\nAll smoke checks passed.');
