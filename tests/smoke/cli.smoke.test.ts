import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { beforeAll, describe, expect, it } from 'vitest';

const bin = path.join('bin', 'icopilot.js');

beforeAll(() => {
  if (!existsSync(bin)) {
    const r = spawnSync('npm', ['run', 'build'], {
      stdio: 'inherit',
      shell: process.platform === 'win32',
    });
    expect(r.status).toBe(0);
  }
}, 120_000);

describe('CLI smoke', () => {
  it('--help exits 0 and contains iCopilot', () => {
    const r = spawnSync('node', [bin, '--help'], { encoding: 'utf8' });
    expect(r.status).toBe(0);
    expect(r.stdout).toMatch(/iCopilot/i);
  }, 30_000);

  it('--version prints semver', () => {
    const r = spawnSync('node', [bin, '--version'], { encoding: 'utf8' });
    expect(r.status).toBe(0);
    expect(r.stdout).toMatch(/\d+\.\d+\.\d+/);
  }, 30_000);

  it('rejects missing GITHUB_TOKEN with helpful message', () => {
    const env = { ...process.env };
    delete env.GITHUB_TOKEN;
    delete env.ICOPILOT_TOKEN;
    const r = spawnSync('node', [bin, '-p', 'hello'], { encoding: 'utf8', env });
    expect(r.status).not.toBe(0);
    const out = (r.stderr || '') + (r.stdout || '');
    expect(out).toMatch(/GITHUB_TOKEN/i);
  }, 30_000);
});
