import fs from 'node:fs';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { SlashContext } from '../../src/commands/slash.js';
import { config } from '../../src/config.js';
import { AutoMemory } from '../../src/knowledge/auto-memory.js';

const compactSessionMock = vi.fn();
const runAutopilotMock = vi.hoisted(() => vi.fn());
const releaseCommandMock = vi.hoisted(() => vi.fn());
const goToDefinitionMock = vi.hoisted(() => vi.fn());
const findReferencesMock = vi.hoisted(() => vi.fn());
const localProviderConfigureMock = vi.hoisted(() => vi.fn());
const localProviderIsAvailableMock = vi.hoisted(() => vi.fn());
const localProviderListModelsMock = vi.hoisted(() => vi.fn());
const openEditorMock = vi.hoisted(() => vi.fn());
const goalPlanMock = vi.hoisted(() => vi.fn());
const goalExecuteMock = vi.hoisted(() => vi.fn());
const goalProgressMock = vi.hoisted(() => vi.fn());
const healAndRetryMock = vi.hoisted(() => vi.fn());
const confirmPromptMock = vi.hoisted(() => vi.fn());
const inputPromptMock = vi.hoisted(() => vi.fn());
const selectPromptMock = vi.hoisted(() => vi.fn());
const spawnSyncMock = vi.hoisted(() => vi.fn());
const openBrowserMock = vi.hoisted(() => vi.fn());
const worktreeCommandMock = vi.hoisted(() => vi.fn(() => 'Git worktrees\n'));
const readClipboardMock = vi.hoisted(() => vi.fn());
const copyTextToClipboardMock = vi.hoisted(() => vi.fn());
const copyContextToClipboardMock = vi.hoisted(() => vi.fn());
const apiServerMock = vi.hoisted(() => ({
  start: vi.fn(),
  stop: vi.fn(),
  isRunning: vi.fn(),
  getPort: vi.fn(),
  getSessionCount: vi.fn(),
}));

vi.mock('../../src/agents/goal-driven.js', () => ({
  GoalDrivenAgent: vi.fn().mockImplementation(() => ({
    plan: goalPlanMock,
    execute: goalExecuteMock,
    getProgress: goalProgressMock,
  })),
}));
vi.mock('@inquirer/prompts', () => ({
  confirm: confirmPromptMock,
  input: inputPromptMock,
  select: selectPromptMock,
}));
const pluginCommandMock = vi.hoisted(() => vi.fn(async () => 'Plugins\n  azure-tools\n'));
const fullCycleMock = vi.hoisted(() => vi.fn());
const fetchAndConvertMock = vi.hoisted(() => vi.fn());
const validateWebUrlMock = vi.hoisted(() => vi.fn((value: string) => new URL(value)));

vi.mock('../../src/commands/git.js', () => ({
  showDiff: vi.fn(),
  commitFromStaged: vi.fn(),
  prDescription: vi.fn(),
}));

vi.mock('../../src/context/compactor.js', () => ({
  compactSession: compactSessionMock,
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

vi.mock('../../src/commands/rag-cmd.js', () => ({
  ragCommand: vi.fn(async () => 'RAG stats\n'),
}));

vi.mock('../../src/commands/diff-review-cmd.js', () => ({
  reviewDiff: vi.fn(),
}));

vi.mock('../../src/commands/release-cmd.js', () => ({
  releaseCommand: releaseCommandMock,
}));

vi.mock('../../src/commands/clipboard-cmd.js', () => ({
  readClipboard: readClipboardMock,
  copyTextToClipboard: copyTextToClipboardMock,
  copyContextToClipboard: copyContextToClipboardMock,
}));

vi.mock('node:child_process', async () => {
  const actual = await vi.importActual<typeof import('node:child_process')>('node:child_process');
  return {
    ...actual,
    spawnSync: spawnSyncMock,
  };
});

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

vi.mock('../../src/modes/autopilot.js', () => ({
  runAutopilot: runAutopilotMock,
}));

vi.mock('../../src/intelligence/navigation.js', () => ({
  goToDefinition: goToDefinitionMock,
  findReferences: findReferencesMock,
}));

vi.mock('../../src/server/api-server.js', () => ({
  DEFAULT_API_PORT: 8787,
  getGlobalAPIServer: () => apiServerMock,
}));

vi.mock('../../src/util/browser.js', () => ({
  openBrowser: openBrowserMock,
}));

vi.mock('../../src/commands/worktree-cmd.js', () => ({
  worktreeCommand: worktreeCommandMock,
}));

vi.mock('../../src/providers/local-model.js', () => ({
  LOCAL_PROVIDER_DEFAULTS: {
    ollama: { baseUrl: 'http://127.0.0.1:11434/v1', model: 'llama3.2' },
    vllm: { baseUrl: 'http://127.0.0.1:8000/v1', model: 'local-model' },
    lmstudio: { baseUrl: 'http://127.0.0.1:1234/v1', model: 'local-model' },
    custom: { baseUrl: 'http://127.0.0.1:8000/v1', model: 'local-model' },
  },
  isLocalProviderName: (value: string) =>
    value === 'ollama' || value === 'vllm' || value === 'lmstudio' || value === 'custom',
  localModelProvider: {
    configure: localProviderConfigureMock,
    isAvailable: localProviderIsAvailableMock,
    listModels: localProviderListModelsMock,
  },
}));

vi.mock('../../src/commands/editor-cmd.js', () => ({
  openEditor: openEditorMock,
}));

vi.mock('../../src/plugins/marketplace.js', () => ({
  pluginCommand: pluginCommandMock,
  Marketplace: class {},
}));

vi.mock('../../src/agents/tdd-agent.js', () => ({
  TDDAgent: vi.fn().mockImplementation(() => ({
    fullCycle: fullCycleMock,
  })),
}));

vi.mock('../../src/agents/self-heal.js', () => ({
  SelfHealingBuilder: vi.fn().mockImplementation(() => ({
    healAndRetry: healAndRetryMock,
  })),
}));

vi.mock('../../src/commands/web-cmd.js', () => ({
  fetchAndConvert: fetchAndConvertMock,
  validateWebUrl: validateWebUrlMock,
}));

let tmpDir: string;
let tmpRoot: string;
let originalCwd: string;
let stdoutSpy: ReturnType<typeof vi.spyOn>;
let output: string;
let originalCorrectionsPath: string | undefined;
let originalAutoMemoryPath: string | undefined;
let originalAutoLint: boolean;
let originalAutoTest: boolean;
let originalAutoFix: boolean;

function createContext(mode: 'ask' | 'plan' = 'ask'): SlashContext {
  const session = {
    state: {
      model: 'gpt-test',
      mode,
      cwd: tmpDir,
      messages: [{ role: 'user', content: 'hello' }],
      autopilotEnabled: false,
    },
    reset: vi.fn(),
    setModel: vi.fn((model: string) => {
      session.state.model = model;
    }),
    setCwd: vi.fn((cwd: string) => {
      session.state.cwd = cwd;
    }),
    setMode: vi.fn((nextMode: 'ask' | 'plan') => {
      session.state.mode = nextMode;
    }),
    setAutopilotEnabled: vi.fn((enabled: boolean) => {
      session.state.autopilotEnabled = enabled;
    }),
    push: vi.fn((message: { role: string; content: string }) => {
      session.state.messages.push(message);
    }),
    tokenUsage: vi.fn(() => 42),
    compactInto: vi.fn(),
  };

  return {
    session: session as unknown as SlashContext['session'],
    abort: new AbortController(),
    exit: vi.fn(),
  };
}

beforeEach(() => {
  tmpRoot = path.join(process.cwd(), '.vitest-slash-tmp');
  fs.mkdirSync(tmpRoot, { recursive: true });
  tmpDir = fs.mkdtempSync(path.join(tmpRoot, 'case-'));
  originalCwd = config.cwd;
  originalAutoLint = config.autoLint;
  originalAutoTest = config.autoTest;
  originalAutoFix = config.autoFix;
  config.cwd = tmpDir;
  output = '';
  originalCorrectionsPath = process.env.ICOPILOT_CORRECTIONS_PATH;
  originalAutoMemoryPath = process.env.ICOPILOT_AUTO_MEMORY_PATH;
  process.env.ICOPILOT_CORRECTIONS_PATH = path.join(tmpDir, 'corrections.json');
  process.env.ICOPILOT_AUTO_MEMORY_PATH = path.join(tmpDir, 'auto-memory.json');
  healAndRetryMock.mockResolvedValue({
    success: true,
    command: 'npm run typecheck',
    attempts: [],
    build: {
      success: true,
      command: 'npm run typecheck',
      exitCode: 0,
      stdout: '',
      stderr: '',
      errors: [],
    },
  });
  config.provider = 'github';
  config.endpoint = 'https://models.inference.ai.azure.com';
  config.defaultModel = 'gpt-4o-mini';
  config.editFormat = 'diff';
  config.token = 'test-token';
  config.autoLint = false;
  config.autoTest = false;
  config.autoFix = true;
  config.reasoningEffort = undefined;
  config.thinkTokens = undefined;
  stdoutSpy = vi.spyOn(process.stdout, 'write').mockImplementation((chunk: string | Uint8Array) => {
    output += String(chunk);
    return true;
  });
  compactSessionMock.mockResolvedValue('compacted summary');
  localProviderConfigureMock.mockReset();
  localProviderIsAvailableMock.mockReset();
  localProviderListModelsMock.mockReset();
  goalPlanMock.mockReturnValue({
    goal: { description: 'Ship the goal command' },
    steps: [{ id: 'analyze-goal', description: 'Analyze the goal', type: 'analyze' }],
    estimatedTokens: 64,
  });
  goalExecuteMock.mockResolvedValue({
    goal: { description: 'Ship the goal command' },
    plan: goalPlanMock(),
    success: true,
    attempts: 1,
    summary: 'done',
    aborted: false,
    stepResults: [],
    verification: { ok: true, score: 1, issues: [], attempts: 1 },
  });
  goalProgressMock.mockReturnValue({
    phase: 'completed',
    currentAttempt: 1,
    maxAttempts: 3,
    completedSteps: 1,
    totalSteps: 1,
    result: undefined,
  });
  confirmPromptMock.mockResolvedValue(false);
  inputPromptMock.mockResolvedValue('The CLI is great');
  selectPromptMock.mockResolvedValue('praise');
});

afterEach(() => {
  stdoutSpy.mockRestore();
  if (originalCorrectionsPath === undefined) {
    delete process.env.ICOPILOT_CORRECTIONS_PATH;
  } else {
    process.env.ICOPILOT_CORRECTIONS_PATH = originalCorrectionsPath;
  }
  if (originalAutoMemoryPath === undefined) {
    delete process.env.ICOPILOT_AUTO_MEMORY_PATH;
  } else {
    process.env.ICOPILOT_AUTO_MEMORY_PATH = originalAutoMemoryPath;
  }
  config.cwd = originalCwd;
  config.autoLint = originalAutoLint;
  config.autoTest = originalAutoTest;
  config.autoFix = originalAutoFix;
  fs.rmSync(tmpRoot, { recursive: true, force: true });
  vi.clearAllMocks();
});

describe('handleSlash', { timeout: 180_000 }, () => {
  it('ignores non-slash input', async () => {
    const { handleSlash } = await import('../../src/commands/slash.js');
    await expect(handleSlash('hello', createContext())).resolves.toEqual({
      handled: false,
      consumed: false,
    });
  });

  it('recognizes /help', async () => {
    const { handleSlash } = await import('../../src/commands/slash.js');
    const result = await handleSlash('/help', createContext());

    expect(result).toEqual({ handled: true, consumed: true });
    expect(output).toContain('Slash commands');
    expect(output).toContain('/role');
    expect(output).toContain('/plugin');
    expect(output).toContain('/paste');
    expect(output).toContain('/workflow');
    expect(output).toContain('/tdd');
    expect(output).toContain('/editor');
    expect(output).toContain('/serve');
    expect(output).toContain('/worktree');
    expect(output).toContain('Ctrl+X Ctrl+E');
    expect(output).toContain('/auto-lint');
    expect(output).toContain('/auto-test');
    expect(output).toContain('/auto-fix');
  });

  it('toggles /auto-lint and reports the detected command', async () => {
    fs.writeFileSync(
      path.join(tmpDir, 'package.json'),
      JSON.stringify({ scripts: { lint: 'eslint "src/**/*.ts"' } }),
      'utf8',
    );
    const { handleSlash } = await import('../../src/commands/slash.js');

    await handleSlash('/auto-lint on', createContext());

    expect(config.autoLint).toBe(true);
    expect(output).toContain('auto-lint');
    expect(output).toContain('on');
    expect(output).toContain('npm run lint');
  });

  it('toggles /auto-test and /auto-fix', async () => {
    fs.writeFileSync(
      path.join(tmpDir, 'package.json'),
      JSON.stringify({ scripts: { test: 'vitest run' } }),
      'utf8',
    );
    const { handleSlash } = await import('../../src/commands/slash.js');

    await handleSlash('/auto-test on', createContext());
    expect(config.autoTest).toBe(true);
    expect(output).toContain('auto-test');
    expect(output).toContain('npm test');

    output = '';
    await handleSlash('/auto-fix off', createContext());
    expect(config.autoFix).toBe(false);
    expect(output).toContain('auto-fix');
    expect(output).toContain('off');
  });

  it('forwards /editor content as the next user message', async () => {
    const { handleSlash } = await import('../../src/commands/slash.js');
    openEditorMock.mockResolvedValue('Draft a careful multi-line prompt');

    const result = await handleSlash('/editor', createContext());

    expect(openEditorMock).toHaveBeenCalled();
    expect(result).toEqual({
      handled: true,
      consumed: false,
      forwardInput: 'Draft a careful multi-line prompt',
    });
  });

  it('recognizes /paste and forwards clipboard text', async () => {
    readClipboardMock.mockResolvedValue({
      type: 'text',
      content: 'clipboard prompt',
    });
    const { handleSlash } = await import('../../src/commands/slash.js');

    const result = await handleSlash('/paste', createContext());

    expect(readClipboardMock).toHaveBeenCalled();
    expect(result).toEqual({
      handled: true,
      consumed: false,
      forwardInput: 'clipboard prompt',
    });
    expect(output).toContain('pasted clipboard');
  });

  it('recognizes /copy-context last and copies the latest exchange', async () => {
    const { handleSlash } = await import('../../src/commands/slash.js');
    const ctx = createContext();
    ctx.session.state.systemPrompt = 'Use concise answers.';
    ctx.session.state.messages = [
      { role: 'user', content: 'first question' },
      { role: 'assistant', content: 'first answer' },
      { role: 'user', content: 'last question' },
      { role: 'assistant', content: 'last answer' },
    ];

    const result = await handleSlash('/copy-context last', ctx);

    expect(result).toMatchObject({
      handled: true,
      consumed: true,
    });
    expect(copyContextToClipboardMock).toHaveBeenCalledTimes(1);
    const copiedMessages = copyContextToClipboardMock.mock.calls[0][0];
    expect(copiedMessages.at(-2)).toMatchObject({ role: 'user', content: 'last question' });
    expect(copiedMessages.at(-1)).toMatchObject({ role: 'assistant', content: 'last answer' });
    expect(output).toContain('copied');
  });

  it('recognizes /clear', async () => {
    const { handleSlash } = await import('../../src/commands/slash.js');
    const ctx = createContext();

    await handleSlash('/clear', ctx);

    expect(ctx.session.reset).toHaveBeenCalled();
    expect(output).toContain('history cleared');
  });

  it('recognizes /model with and without an argument', async () => {
    const { handleSlash } = await import('../../src/commands/slash.js');
    const ctx = createContext();

    await handleSlash('/model', ctx);
    expect(output).toContain('current model: gpt-test');

    await handleSlash('/model gpt-4o', ctx);
    expect(ctx.session.setModel).toHaveBeenCalledWith('gpt-4o');
    expect(output).toContain('model');
  });

  it('accepts unique slash command prefixes', async () => {
    const { handleSlash } = await import('../../src/commands/slash.js');
    const ctx = createContext();

    await handleSlash('/mod gpt-4o', ctx);

    expect(ctx.session.setModel).toHaveBeenCalledWith('gpt-4o');
    expect(output).toContain('/mod → /model');
  });

  it('recognizes /provider and /provider set', async () => {
    const { handleSlash } = await import('../../src/commands/slash.js');
    const ctx = createContext();

    await handleSlash('/provider', ctx);
    expect(output).toContain('Current provider');
    expect(output).toContain('github');

    await handleSlash('/provider set ollama', ctx);
    expect(ctx.session.setModel).toHaveBeenCalledWith('llama3.2');
    expect(config.provider).toBe('ollama');
    expect(config.endpoint).toBe('http://127.0.0.1:11434/v1');
    expect(output).toContain('provider');
  });

  it('recognizes /provider test for local providers', async () => {
    const { handleSlash } = await import('../../src/commands/slash.js');
    const ctx = createContext();
    config.provider = 'ollama';
    config.endpoint = 'http://127.0.0.1:11434/v1';
    localProviderIsAvailableMock.mockResolvedValue(true);
    localProviderListModelsMock.mockResolvedValue(['llama3.2', 'qwen2.5']);

    await handleSlash('/provider test', ctx);

    expect(localProviderConfigureMock).toHaveBeenCalledWith({
      provider: 'ollama',
      baseUrl: 'http://127.0.0.1:11434/v1',
      model: 'gpt-test',
      apiKey: 'test-token',
    });
    expect(output).toContain('local provider reachable');
    expect(output).toContain('llama3.2');
  });

  it('recognizes /reasoning and /think-tokens', async () => {
    const { handleSlash } = await import('../../src/commands/slash.js');
    const ctx = createContext();

    await handleSlash('/reasoning high', ctx);
    expect(config.reasoningEffort).toBe('high');
    expect(output).toContain('reasoning effort');

    output = '';
    await handleSlash('/think-tokens 8k', ctx);
    expect(config.thinkTokens).toBe(8192);
    expect(output).toContain('8192');

    output = '';
    await handleSlash('/reasoning', ctx);
    expect(output).toContain('effort: high');
    expect(output).toContain('think tokens: 8192');

    output = '';
    await handleSlash('/think-tokens 0', ctx);
    expect(config.thinkTokens).toBeUndefined();
    expect(output).toContain('disabled');
  });

  it('recognizes /cwd with and without an argument', async () => {
    const { handleSlash } = await import('../../src/commands/slash.js');
    const ctx = createContext();
    const nextDir = path.join(tmpDir, 'next');
    fs.mkdirSync(nextDir);

    await handleSlash('/cwd', ctx);
    expect(output).toContain(`cwd: ${tmpDir}`);

    await handleSlash('/cwd next', ctx);
    expect(config.cwd).toBe(nextDir);
    expect(ctx.session.setCwd).toHaveBeenCalledWith(nextDir);
  });

  it('recognizes /context', async () => {
    const { handleSlash } = await import('../../src/commands/slash.js');
    const ctx = createContext();

    await handleSlash('/context', ctx);

    expect(output).toContain('Context Window Usage');
    expect(output).toContain('tokens used');
    expect(output).toContain('Model:');
  });

  it('recognizes /settings show, set, and reset', async () => {
    const { handleSlash } = await import('../../src/commands/slash.js');
    const ctx = createContext();
    const originalTheme = config.theme;

    await handleSlash('/settings', ctx);
    expect(output).toContain('Settings');
    expect(output).toContain('model');

    output = '';
    await handleSlash('/settings theme dark', ctx);
    expect(output).toContain('setting theme');
    expect(config.theme).toBe('dark');

    output = '';
    await handleSlash('/settings reset theme', ctx);
    expect(output).toContain('reset theme');
    expect(config.theme).toBe(originalTheme);
  });

  it('recognizes /feedback quick reports', async () => {
    const { handleSlash } = await import('../../src/commands/slash.js');

    await handleSlash('/feedback bug Context usage is wrong', createContext());

    expect(output).toContain('Thank you for your feedback!');
  });

  it('recognizes /corrections add, list, remove, and clear', async () => {
    const { handleSlash } = await import('../../src/commands/slash.js');
    const ctx = createContext();

    await handleSlash(
      '/corrections add rename slash commands -> preserve existing slash command names',
      ctx,
    );
    expect(output).toContain('Remembered correction');

    output = '';
    await handleSlash('/corrections', ctx);
    expect(output).toContain('Do NOT rename slash commands');
    const match = output.match(/[0-9a-f]{8}-[0-9a-f-]{27}/i);
    expect(match?.[0]).toBeTruthy();

    output = '';
    await handleSlash(`/corrections remove ${match![0]}`, ctx);
    expect(output).toContain('Removed correction');

    output = '';
    await handleSlash('/corrections add omit tests -> add targeted tests', ctx);
    output = '';
    await handleSlash('/corrections clear', ctx);
    expect(output).toContain('Cleared 1 correction');
  });

  it('recognizes /memory auto list, forget, and clear', async () => {
    const { handleSlash } = await import('../../src/commands/slash.js');
    const ctx = createContext();
    const autoMemory = new AutoMemory(process.env.ICOPILOT_AUTO_MEMORY_PATH);
    const first = autoMemory.addMemory('Project build command: npm run build.', 'discovery');
    const second = autoMemory.addMemory('User preference: always use tabs.', 'preference');
    autoMemory.save();

    await handleSlash('/memory auto', ctx);
    expect(output).toContain('Auto memory');
    expect(output).toContain('Project build command: npm run build.');
    expect(output).toContain('User preference: always use tabs.');

    output = '';
    await handleSlash(`/memory auto forget ${first?.id}`, ctx);
    expect(output).toContain('Forgot auto-memory');

    output = '';
    await handleSlash('/memory auto clear', ctx);
    expect(output).toContain('Cleared 1 auto-memory');

    const reloaded = new AutoMemory(process.env.ICOPILOT_AUTO_MEMORY_PATH);
    reloaded.load();
    expect(reloaded.memories).toHaveLength(0);
    expect(second).toBeTruthy();
  });

  it('recognizes /role and persists role changes', async () => {
    const { handleSlash } = await import('../../src/commands/slash.js');
    const ctx = createContext();

    await handleSlash('/role', ctx);
    expect(output).toContain('Current role');
    expect(output).toContain('developer');

    output = '';
    await handleSlash('/role set viewer', ctx);
    expect(output).toContain('role');
    expect(output).toContain('viewer');

    output = '';
    await handleSlash('/role list', ctx);
    expect(output).toContain('Roles');
    expect(output).toContain('admin');
    expect(output).toContain('viewer');
  });

  it('recognizes /plan', async () => {
    const { handleSlash } = await import('../../src/commands/slash.js');
    const ctx = createContext('ask');

    await handleSlash('/plan', ctx);

    expect(ctx.session.setMode).toHaveBeenCalledWith('plan');
    expect(output).toContain('mode');
  });

  it('recognizes /edit-format with and without an argument', async () => {
    const { handleSlash } = await import('../../src/commands/slash.js');
    const ctx = createContext('ask');

    await handleSlash('/edit-format', ctx);
    expect(output).toContain('edit format: diff');

    output = '';
    await handleSlash('/edit-format whole', ctx);
    expect(config.editFormat).toBe('whole');
    expect(output).toContain('edit format');
  });

  it('toggles /autopilot with no goal', async () => {
    const { handleSlash } = await import('../../src/commands/slash.js');
    const ctx = createContext('ask');

    await handleSlash('/autopilot', ctx);

    expect(ctx.session.setAutopilotEnabled).toHaveBeenCalledWith(true);
    expect(output).toContain('autopilot');
  });

  it('runs /autopilot <goal>', async () => {
    const { handleSlash } = await import('../../src/commands/slash.js');
    const ctx = createContext('ask');

    await handleSlash('/autopilot wire the CLI', ctx);

    expect(runAutopilotMock).toHaveBeenCalledWith('wire the CLI', {
      session: ctx.session,
      signal: ctx.abort.signal,
    });
  });

  it('recognizes /tasks', async () => {
    const { handleSlash } = await import('../../src/commands/slash.js');

    await handleSlash('/tasks', createContext());

    expect(output).toContain('Background tasks');
  });

  it('manages /bridge lifecycle', async () => {
    const { handleSlash } = await import('../../src/commands/slash.js');
    const port = '17891';

    await handleSlash(`/bridge start ${port}`, createContext());
    expect(output).toContain('IDE bridge started');
    expect(output).toContain(port);

    output = '';
    await handleSlash('/bridge status', createContext());
    expect(output).toContain('IDE bridge status');
    expect(output).toContain('connections');

    output = '';
    await handleSlash('/bridge stop', createContext());
    expect(output).toContain('IDE bridge stopped');
  });

  it('recognizes /goto', async () => {
    const { handleSlash } = await import('../../src/commands/slash.js');
    goToDefinitionMock.mockReturnValue({
      file: path.join('src', 'types.ts'),
      line: 3,
      column: 14,
      context: 'export const widget = 1;',
    });

    await handleSlash('/goto widget', createContext());

    expect(goToDefinitionMock).toHaveBeenCalledWith('widget', tmpDir);
    expect(output).toContain('Definition');
    expect(output).toContain(path.join('src', 'types.ts'));
    expect(output).toContain('export const widget = 1;');
  });

  it('recognizes /refs', async () => {
    const { handleSlash } = await import('../../src/commands/slash.js');
    findReferencesMock.mockReturnValue([
      {
        file: path.join('src', 'usage.ts'),
        line: 4,
        column: 15,
        context: 'const total = widget + widget;',
      },
    ]);

    await handleSlash('/refs widget', createContext());

    expect(findReferencesMock).toHaveBeenCalledWith('widget', tmpDir);
    expect(output).toContain('References');
    expect(output).toContain('const total = widget + widget;');
  });

  it('recognizes /rag', async () => {
    const { handleSlash } = await import('../../src/commands/slash.js');

    await handleSlash('/rag stats', createContext());

    expect(output).toContain('RAG stats');
  });

  it('recognizes /plugin', async () => {
    const { handleSlash } = await import('../../src/commands/slash.js');

    await handleSlash('/plugin list', createContext());

    expect(pluginCommandMock).toHaveBeenCalledWith(['list']);
    expect(output).toContain('Plugins');
    expect(output).toContain('azure-tools');
  });

  it('recognizes /codegen', async () => {
    const { handleSlash } = await import('../../src/commands/slash.js');
    fs.writeFileSync(path.join(tmpDir, 'tsconfig.json'), '{\n  "compilerOptions": {}\n}\n', 'utf8');

    await handleSlash(
      '/codegen --type command --name session-summary Generate a session summary command',
      createContext(),
    );

    expect(output).toContain('Codegen preview');
    expect(fs.existsSync(path.join(tmpDir, 'src', 'commands', 'session-summary-cmd.ts'))).toBe(
      true,
    );
    expect(
      fs.existsSync(path.join(tmpDir, 'tests', 'commands', 'session-summary-cmd.test.ts')),
    ).toBe(true);
  });

  it('recognizes /web and injects fetched content into conversation history', async () => {
    const { handleSlash } = await import('../../src/commands/slash.js');
    const ctx = createContext();
    fetchAndConvertMock.mockResolvedValue({
      title: 'Example',
      markdown: '# Heading\n\nLoaded content.',
      tokens: 12,
    });

    await handleSlash('/web https://example.com focus on headings', ctx);

    expect(validateWebUrlMock).toHaveBeenCalledWith('https://example.com');
    expect(fetchAndConvertMock).toHaveBeenCalledWith('https://example.com/');
    expect(output).toContain('Web context added');
    expect(output).toContain('Example');
    expect(output).toContain('tokens: 12');
    expect(ctx.session.state.messages.at(-1)).toEqual({
      role: 'user',
      content:
        'Content from https://example.com/:\nFocus on: focus on headings\n\n# Heading\n\nLoaded content.',
    });
  });

  it('recognizes /release', async () => {
    releaseCommandMock.mockResolvedValue('Release preview\n');
    const { handleSlash } = await import('../../src/commands/slash.js');

    await handleSlash('/release preview', createContext());

    expect(releaseCommandMock).toHaveBeenCalledWith(['preview'], tmpDir);
    expect(output).toContain('Release preview');
  });

  it('recognizes /serve start [port]', async () => {
    apiServerMock.start.mockResolvedValue(9900);
    apiServerMock.getSessionCount.mockReturnValue(2);
    const { handleSlash } = await import('../../src/commands/slash.js');

    await handleSlash('/serve start 9900', createContext());

    expect(apiServerMock.start).toHaveBeenCalledWith(9900);
    expect(output).toContain('API server started');
    expect(output).toContain('9900');
  });

  it('recognizes /serve stop', async () => {
    apiServerMock.isRunning.mockReturnValue(true);
    apiServerMock.stop.mockResolvedValue(undefined);
    const { handleSlash } = await import('../../src/commands/slash.js');

    await handleSlash('/serve stop', createContext());

    expect(apiServerMock.stop).toHaveBeenCalled();
    expect(output).toContain('API server stopped');
  });

  it('recognizes /serve open [port]', async () => {
    apiServerMock.start.mockResolvedValue(8787);
    openBrowserMock.mockResolvedValue(undefined);
    const { handleSlash } = await import('../../src/commands/slash.js');

    await handleSlash('/serve open 8787', createContext());

    expect(apiServerMock.start).toHaveBeenCalledWith(8787);
    expect(openBrowserMock).toHaveBeenCalledWith('http://127.0.0.1:8787/');
    expect(output).toContain('opened browser UI');
  });

  it('recognizes /worktree', async () => {
    const { handleSlash } = await import('../../src/commands/slash.js');

    await handleSlash('/worktree list', createContext());

    expect(worktreeCommandMock).toHaveBeenCalledWith(['list'], tmpDir);
    expect(output).toContain('Git worktrees');
  });

  it('recognizes /heal --max', async () => {
    const { handleSlash } = await import('../../src/commands/slash.js');

    await handleSlash('/heal --max 5', createContext());

    expect(healAndRetryMock).toHaveBeenCalledWith(5);
    expect(output).toContain('Self-heal build');
    expect(output).toContain('success');
  });

  it('recognizes /goal and reports status', async () => {
    const { handleSlash } = await import('../../src/commands/slash.js');

    await handleSlash('/goal ship the CLI workflow', createContext());
    await Promise.resolve();
    await handleSlash('/goal status', createContext());

    expect(goalPlanMock).toHaveBeenCalledWith({ description: 'ship the CLI workflow' });
    expect(goalExecuteMock).toHaveBeenCalled();
    expect(output).toContain('goal started');
    expect(output).toContain('Goal run');
  });

  it('reports when no goal run is active for /goal abort', async () => {
    const { handleSlash } = await import('../../src/commands/slash.js');

    await handleSlash('/goal abort', createContext());

    expect(output).toContain('No active goal run');
  });

  it('recognizes /tdd and reports status', async () => {
    fullCycleMock.mockReturnValue({
      spec: {
        description: 'Build a TDD helper',
        expectedBehaviors: ['captures the original description'],
      },
      testFile: path.join(tmpDir, 'tests', 'tdd', 'build-a-tdd-helper.test.ts'),
      sourceFile: path.join(tmpDir, 'src', 'tdd', 'build-a-tdd-helper.ts'),
      cycles: 2,
      finalStatus: 'green',
    });
    const { handleSlash } = await import('../../src/commands/slash.js');

    await handleSlash('/tdd Build a TDD helper', createContext());

    expect(fullCycleMock).toHaveBeenCalledWith(
      expect.objectContaining({
        description: 'Build a TDD helper',
        expectedBehaviors: expect.any(Array),
      }),
    );
    expect(output).toContain('TDD cycle');
    expect(output).toContain('green');

    output = '';
    await handleSlash('/tdd status', createContext());

    expect(output).toContain('TDD status');
    expect(output).toContain('build-a-tdd-helper.test.ts');
  });

  it('shows suggestions for near-miss slash commands', async () => {
    const { handleSlash } = await import('../../src/commands/slash.js');
    const result = await handleSlash('/modl gpt-4o', createContext());

    expect(result).toEqual({ handled: true, consumed: true });
    expect(output).toContain('unknown command: /modl');
    expect(output).toContain('Did you mean: /model');
  });

  it('reports unknown slash commands as consumed', async () => {
    const { handleSlash } = await import('../../src/commands/slash.js');
    const result = await handleSlash('/zzz', createContext());

    expect(result).toEqual({ handled: true, consumed: true });
    expect(output).toContain('unknown command: /zzz');
  });
});
