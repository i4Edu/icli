import fs from 'node:fs';
import { spawnSync } from 'node:child_process';

const VALID_BUMPS = new Set(['patch', 'minor', 'major']);
const args = process.argv.slice(2);
const bump = args.find((arg) => VALID_BUMPS.has(arg)) || 'patch';
const force = args.includes('--force');
const packagePath = 'package.json';
const originalPackage = fs.readFileSync(packagePath, 'utf8');
let bumped = false;
let nextVersion = '';

function run(command, commandArgs, options = {}) {
  const result = spawnSync(command, commandArgs, {
    stdio: 'inherit',
    shell: process.platform === 'win32',
    ...options,
  });
  if (result.status !== 0) {
    throw new Error(`${command} ${commandArgs.join(' ')} failed with exit ${result.status}`);
  }
}

function capture(command, commandArgs) {
  return spawnSync(command, commandArgs, {
    encoding: 'utf8',
    shell: process.platform === 'win32',
  });
}

function ensureCleanTree() {
  const status = capture('git', ['status', '--porcelain']);
  if (status.status !== 0) throw new Error('failed to inspect git status');
  if (status.stdout.trim() && !force) {
    throw new Error('working tree is dirty; commit/stash changes or rerun with --force');
  }
  if (status.stdout.trim()) {
    console.warn('warning: working tree is dirty; continuing because --force was provided');
  }
}

function bumpVersion(version, level) {
  const parts = version.split('.').map(Number);
  if (parts.length !== 3 || parts.some((part) => !Number.isInteger(part) || part < 0)) {
    throw new Error(`unsupported semver version: ${version}`);
  }
  if (level === 'major') return `${parts[0] + 1}.0.0`;
  if (level === 'minor') return `${parts[0]}.${parts[1] + 1}.0`;
  return `${parts[0]}.${parts[1]}.${parts[2] + 1}`;
}

try {
  ensureCleanTree();
  run('npm', ['run', 'typecheck']);
  run('npm', ['run', 'lint']);
  run('npm', ['test']);
  run('npm', ['run', 'build']);

  const pkg = JSON.parse(originalPackage);
  nextVersion = bumpVersion(pkg.version, bump);
  pkg.version = nextVersion;
  fs.writeFileSync(packagePath, `${JSON.stringify(pkg, null, 2)}\n`, 'utf8');
  bumped = true;

  run('node', ['scripts/changelog.mjs', '--bump', nextVersion]);
  run('git', ['add', 'package.json', 'CHANGELOG.md']);
  run('git', ['commit', '-m', `chore(release): v${nextVersion}`]);
  run('git', ['tag', `v${nextVersion}`]);

  console.log(`\nRelease v${nextVersion} is committed and tagged.`);
  console.log('Next steps:');
  console.log('  git push origin HEAD');
  console.log(`  git push origin v${nextVersion}`);
  console.log('  npm publish --provenance --access public');
} catch (error) {
  if (bumped) {
    fs.writeFileSync(packagePath, originalPackage, 'utf8');
    console.error('package.json reverted after release failure. Review CHANGELOG.md before retrying.');
  }
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
}
