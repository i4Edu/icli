import fs from 'node:fs';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  getCustomAgent,
  listCustomAgents,
  loadCustomAgents,
} from '../../src/agents/custom-agents.js';

let tmpRoot: string;
let tmpDir: string;

beforeEach(() => {
  tmpRoot = path.join(process.cwd(), '.vitest-custom-agents-tmp');
  fs.mkdirSync(tmpRoot, { recursive: true });
  tmpDir = fs.mkdtempSync(path.join(tmpRoot, 'case-'));
});

afterEach(() => {
  fs.rmSync(tmpRoot, { recursive: true, force: true });
});

describe('custom agents', () => {
  it('creates the default agents directory when loading', () => {
    const agents = loadCustomAgents(tmpDir);

    expect(agents).toEqual([]);
    expect(fs.existsSync(path.join(tmpDir, '.icopilot', 'agents'))).toBe(true);
  });

  it('loads validated YAML agent definitions and caches them', () => {
    const agentsDir = path.join(tmpDir, '.icopilot', 'agents');
    fs.mkdirSync(agentsDir, { recursive: true });
    fs.writeFileSync(
      path.join(agentsDir, 'repo-guide.yaml'),
      [
        'name: repo-guide',
        'description: Summarize repository structure',
        'systemPrompt: |',
        '  You are a repository guide.',
        'model: gpt-4o-mini',
        'temperature: 0.4',
        'tools:',
        '  - rg',
        '  - view',
        'maxTokens: 2048',
        '',
      ].join('\n'),
      'utf8',
    );
    fs.writeFileSync(
      path.join(agentsDir, 'reviewer.yaml'),
      [
        'name: reviewer',
        'description: Review risky changes',
        'systemPrompt: Review for bugs only.',
        '',
      ].join('\n'),
      'utf8',
    );

    const agents = loadCustomAgents(tmpDir);

    expect(agents).toHaveLength(2);
    expect(agents[0]).toEqual({
      name: 'repo-guide',
      description: 'Summarize repository structure',
      systemPrompt: 'You are a repository guide.',
      model: 'gpt-4o-mini',
      temperature: 0.4,
      tools: ['rg', 'view'],
      maxTokens: 2048,
    });
    expect(getCustomAgent('repo-guide')).toEqual(agents[0]);
    expect(getCustomAgent('REVIEWER')?.name).toBe('reviewer');
    expect(listCustomAgents().map((agent) => agent.name)).toEqual(['repo-guide', 'reviewer']);
  });

  it('throws when a YAML definition is invalid', () => {
    const agentsDir = path.join(tmpDir, '.icopilot', 'agents');
    fs.mkdirSync(agentsDir, { recursive: true });
    fs.writeFileSync(
      path.join(agentsDir, 'broken.yaml'),
      [
        'name: broken',
        'description: Broken agent',
        'systemPrompt: test',
        'temperature: 3',
        '',
      ].join('\n'),
      'utf8',
    );

    expect(() => loadCustomAgents(tmpDir)).toThrow(/temperature/);
  });
});
