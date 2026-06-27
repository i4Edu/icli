import fs from 'node:fs';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  bashCompletion,
  defaultContext,
  pwshCompletion,
  zshCompletion,
} from '../../src/util/completion.js';

describe('completion generators', () => {
  let tmpRoot: string;
  let tmpDir: string;

  beforeEach(() => {
    tmpRoot = path.join(process.cwd(), '.vitest-completion-tmp');
    fs.mkdirSync(tmpRoot, { recursive: true });
    tmpDir = fs.mkdtempSync(path.join(tmpRoot, 'case-'));

    const agentsDir = path.join(tmpDir, '.icopilot', 'agents');
    fs.mkdirSync(agentsDir, { recursive: true });
    fs.writeFileSync(
      path.join(agentsDir, 'repo-guide.yaml'),
      [
        'name: repo-guide',
        'description: Summarize the repository',
        'systemPrompt: You are a repository guide.',
        '',
      ].join('\n'),
      'utf8',
    );
  });

  afterEach(() => {
    fs.rmSync(tmpRoot, { recursive: true, force: true });
  });

  it.each([
    ['bash', bashCompletion],
    ['zsh', zshCompletion],
    ['pwsh', pwshCompletion],
  ])('%s completion includes commands, flags, and custom agents', (_name, generate) => {
    const ctx = defaultContext(tmpDir);
    const script = generate(ctx);

    expect(script.length).toBeGreaterThan(0);
    expect(script).toContain('icopilot');
    expect(script).toContain('icli');
    expect(script).toContain('/help');
    expect(script).toContain('/provider');
    expect(script).toContain('/goal');
    expect(script).toContain('/usage');
    expect(script).toContain('/reasoning');
    expect(script).toContain('/think-tokens');
    expect(script).toContain('/share');
    expect(script).toContain('/settings');
    expect(script).toContain('/feedback');
    expect(script).toContain('/editor');
    expect(script).toContain('/paste');
    expect(script).toContain('/heal');
    expect(script).toContain('/auto-lint');
    expect(script).toContain('/auto-test');
    expect(script).toContain('/auto-fix');
    expect(script).toContain('/audit');
    expect(script).toContain('/bridge');
    expect(script).toContain('/memory');
    expect(script).toContain('auto');
    expect(script).toContain('forget');
    expect(script).toContain('/retention');
    expect(script).toContain('/corrections');
    expect(script).toContain('/team-memory');
    expect(script).toContain('/role');
    expect(script).toContain('/hook');
    expect(script).toContain('/diagram');
    expect(script).toContain('/serve');
    expect(script).toContain('/conventions');
    expect(script).toContain('/plugin');
    expect(script).toContain('/tdd');
    expect(script).toContain('/task');
    expect(script).toContain('/sandbox');
    expect(script).toContain('/tasks');
    expect(script).toContain('--prompt');
    expect(script).toContain('--local');
    expect(script).toContain('--provider');
    expect(script).toContain('--serve');
    expect(script).toContain('repo-guide');
  });
});
