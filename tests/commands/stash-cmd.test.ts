import fs from 'node:fs';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

let tmpDir: string;
let stashCommand: typeof import('../../src/commands/stash-cmd.js').stashCommand;
let stashesDir: typeof import('../../src/commands/stash-cmd.js').stashesDir;

beforeEach(async () => {
  tmpDir = path.join(
    process.cwd(),
    '.vitest-stash-cmd-tmp',
    String(process.pid),
    String(Date.now()),
  );
  process.env.ICOPILOT_STASHES_DIR = tmpDir;
  vi.resetModules();

  const commandModule = await import('../../src/commands/stash-cmd.js');
  stashCommand = commandModule.stashCommand;
  stashesDir = commandModule.stashesDir;
});

afterEach(() => {
  delete process.env.ICOPILOT_STASHES_DIR;
  fs.rmSync(path.join(process.cwd(), '.vitest-stash-cmd-tmp'), { recursive: true, force: true });
});

function createSession() {
  return {
    state: {
      messages: [
        { role: 'user', content: 'first' },
        { role: 'assistant', content: 'second' },
      ],
      model: 'gpt-test',
      cwd: 'E:\\AI\\icli',
      mode: 'plan',
    },
    persist: vi.fn(),
  } as unknown as import('../../src/session/session.js').Session;
}

describe('stashCommand', () => {
  it('supports a push/pop cycle with a mock session', () => {
    const session = createSession();

    const pushed = stashCommand(['push', 'focus'], session);
    expect(pushed).toContain('Stashed');
    expect(fs.existsSync(stashesDir())).toBe(true);
    expect(fs.readdirSync(stashesDir())).toHaveLength(1);

    session.state.messages = [];
    session.state.model = 'other-model';
    session.state.cwd = 'E:\\other';
    session.state.mode = 'ask';

    const popped = stashCommand(['pop', 'focus'], session);
    expect(popped).toContain('Restored');
    expect(session.state.messages).toHaveLength(2);
    expect(session.state.model).toBe('gpt-test');
    expect(session.state.cwd).toBe('E:\\AI\\icli');
    expect(session.state.mode).toBe('plan');
    expect(session.persist).toHaveBeenCalled();
    expect(fs.readdirSync(stashesDir())).toHaveLength(0);
  });

  it('formats the stash list with name, date, and message count', () => {
    const session = createSession();

    stashCommand(['push', 'alpha'], session);
    stashCommand(['push', 'beta'], session);

    const output = stashCommand([], session);
    expect(output).toContain('Stashes');
    expect(output).toContain('alpha');
    expect(output).toContain('beta');
    expect(output).toContain('2 msgs');
    expect(output).toContain('[');
  });

  it('drops a named stash', () => {
    const session = createSession();

    stashCommand(['push', 'drop-me'], session);
    expect(fs.readdirSync(stashesDir())).toHaveLength(1);

    const output = stashCommand(['drop', 'drop-me'], session);
    expect(output).toContain('Dropped');
    expect(fs.readdirSync(stashesDir())).toHaveLength(0);
  });

  it('clears all stashes', () => {
    const session = createSession();

    stashCommand(['push', 'one'], session);
    stashCommand(['push', 'two'], session);
    expect(fs.readdirSync(stashesDir())).toHaveLength(2);

    const output = stashCommand(['clear'], session);
    expect(output).toContain('Cleared');
    expect(fs.readdirSync(stashesDir())).toHaveLength(0);
  });
});
