import fs from 'node:fs';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  agentCommand,
  buildAgentPrompt,
  formatAgentResult,
  getAgentConfig,
} from '../../src/commands/agent-cmd.js';
import { defaultContext } from '../../src/util/completion.js';

vi.mock('../../src/commands/git.js', () => ({
  showDiff: vi.fn(),
  commitFromStaged: vi.fn(),
  prDescription: vi.fn(),
}));

vi.mock('../../src/context/compactor.js', () => ({
  compactSession: vi.fn(),
}));

vi.mock('../../src/session/manager.js', () => ({
  pickSession: vi.fn(),
  exportSession: vi.fn(),
}));

vi.mock('../../src/commands/git-extra.js', () => ({
  reviewStaged: vi.fn(),
  draftIssue: vi.fn(),
  scaffoldBranch: vi.fn(),
}));

vi.mock('../../src/commands/index-cmd.js', () => ({
  indexCommand: vi.fn(),
}));

vi.mock('../../src/commands/diff-review-cmd.js', () => ({
  reviewDiff: vi.fn(),
}));

vi.mock('simple-git', () => ({
  default: () => ({
    checkIsRepo: vi.fn().mockResolvedValue(true),
    log: vi.fn().mockResolvedValue({ all: [] }),
    tags: vi.fn().mockResolvedValue({ latest: null }),
  }),
}));

vi.mock('../../src/commands/route-cmd.js', () => ({
  routeCommand: vi.fn(() => 'routing profile: fixed\n'),
}));

let tmpRoot: string;
let tmpDir: string;
let stdoutSpy: ReturnType<typeof vi.spyOn>;
let output = '';

beforeEach(() => {
  tmpRoot = path.join(process.cwd(), '.vitest-agent-cmd-tmp');
  fs.mkdirSync(tmpRoot, { recursive: true });
  tmpDir = fs.mkdtempSync(path.join(tmpRoot, 'case-'));
  output = '';
  stdoutSpy = vi.spyOn(process.stdout, 'write').mockImplementation((chunk: string | Uint8Array) => {
    output += String(chunk);
    return true;
  });
});

afterEach(() => {
  stdoutSpy.mockRestore();
  fs.rmSync(tmpRoot, { recursive: true, force: true });
  vi.clearAllMocks();
});

describe('agent-cmd', { timeout: 30_000 }, () => {
  function writeCustomAgent(name = 'repo-guide'): void {
    const agentsDir = path.join(tmpDir, '.icopilot', 'agents');
    fs.mkdirSync(agentsDir, { recursive: true });
    fs.writeFileSync(
      path.join(agentsDir, `${name}.yaml`),
      [
        `name: ${name}`,
        'description: Summarize the repository',
        'systemPrompt: |',
        '  You are a repository guide.',
        'tools:',
        '  - rg',
        '',
      ].join('\n'),
      'utf8',
    );
  }

  it('returns built-in config for each agent type', () => {
    expect(getAgentConfig('explore').systemPrompt).toBe(
      'You are a codebase exploration agent. Analyze code structure, find relevant files, explain architecture. Use grep/glob tools to search. Be concise and factual.',
    );
    expect(getAgentConfig('task').systemPrompt).toContain('task execution agent');
    expect(getAgentConfig('review').systemPrompt).toContain('Never comment on style');
    expect(getAgentConfig('plan').systemPrompt).toContain('numbered implementation steps');
  });

  it('builds a prompt with agent instructions, cwd, and user query', () => {
    const prompt = buildAgentPrompt('explore', 'find the auth flow', tmpDir);

    expect(prompt).toContain('You are a codebase exploration agent.');
    expect(prompt).toContain(`- Current working directory: ${tmpDir}`);
    expect(prompt).toContain(`- Project folder name: ${path.basename(tmpDir)}`);
    expect(prompt).toContain('Task:\nfind the auth flow');
  });

  it('formats agent results with a badge and metrics', () => {
    const output = formatAgentResult({
      type: 'plan',
      output: '1. Inspect the API\n2. Add tests',
      tokensUsed: 32,
      durationMs: 7,
    });

    expect(output).toContain('PLAN');
    expect(output).toContain('32 tokens');
    expect(output).toContain('7ms');
    expect(output).toContain('1. Inspect the API');
  });

  it('shows usage when invoked without arguments', () => {
    const output = agentCommand([], tmpDir);

    expect(output).toContain('Agent command');
    expect(output).toContain('/agent explore <question>');
    expect(output).toContain('/agent list');
  });

  it('lists available agents', () => {
    writeCustomAgent();
    const output = agentCommand(['list'], tmpDir);

    expect(output).toContain('Available agents');
    expect(output).toContain('Built-in');
    expect(output).toContain('Custom');
    expect(output).toContain('explore');
    expect(output).toContain('task');
    expect(output).toContain('review');
    expect(output).toContain('plan');
    expect(output).toContain('repo-guide');
  });

  it('defaults review to staged changes when no target is provided', () => {
    const output = agentCommand(['review'], tmpDir);

    expect(output).toContain('REVIEW');
    expect(output).toContain('Review the staged changes for bugs, security issues, and logic errors.');
  });

  it('builds an execution prompt for the task agent', () => {
    const output = agentCommand(['task', 'run', 'the', 'full', 'test', 'suite'], tmpDir);

    expect(output).toContain('TASK');
    expect(output).toContain('You are a task execution agent.');
    expect(output).toContain('run the full test suite');
  });

  it('builds a prompt for a custom agent definition', () => {
    writeCustomAgent();

    const output = agentCommand(['repo-guide', 'map', 'the', 'entrypoints'], tmpDir);

    expect(output).toContain('REPO-GUIDE');
    expect(output).toContain('You are a repository guide.');
    expect(output).toContain('Allowed tools: rg');
    expect(output).toContain('map the entrypoints');
  });

  it('wires /agent into slash handling and help text', () => {
    const slashSource = fs.readFileSync(path.join(process.cwd(), 'src', 'commands', 'slash.ts'), 'utf8');

    expect(slashSource).toContain("import { agentCommand } from './agent-cmd.js';");
    expect(slashSource).toContain('/agent <name> [query]');
    expect(slashSource).toContain("case 'agent':");
    expect(slashSource).toContain('agentCommand(rest, s.state.cwd)');
  });

  it('adds /agent to shell completion context', () => {
    expect(defaultContext(tmpDir).slashCommands).toContain('agent');
  });
});
