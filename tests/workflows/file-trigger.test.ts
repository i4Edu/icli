import fs from 'node:fs';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { config } from '../../src/config.js';
import { triggerCommand } from '../../src/commands/trigger-cmd.js';
import { defaultContext } from '../../src/util/completion.js';
import {
  FileTriggerManager,
  getFileTriggerManager,
  matchesFileTriggerPattern,
  triggerConfigPath,
} from '../../src/workflows/file-trigger.js';
type WatchListener = (eventType: string, filename: string | Buffer | null) => void;

let rootDir: string;
let originalCwd: string;

function createWatchStub() {
  let listener: WatchListener | undefined;
  const close = vi.fn();
  const watch = vi.fn(((...args: unknown[]) => {
    listener = args[2] as WatchListener;
    return { close } as unknown as fs.FSWatcher;
  }) as typeof fs.watch);

  return {
    watch,
    close,
    emit(file: string) {
      listener?.('change', file);
    },
  };
}

beforeEach(() => {
  rootDir = fs.mkdtempSync(path.join(process.cwd(), '.test-file-trigger-'));
  originalCwd = config.cwd;
  config.cwd = rootDir;
});

afterEach(() => {
  getFileTriggerManager(rootDir).stop();
  config.cwd = originalCwd;
  vi.restoreAllMocks();
  vi.useRealTimers();
  fs.rmSync(rootDir, { recursive: true, force: true });
});

describe('FileTriggerManager', () => {
  it('persists triggers to .icopilot/triggers.json and reloads them', () => {
    const manager = new FileTriggerManager({ rootDir });

    manager.addTrigger({
      pattern: 'src/**/*.ts',
      action: 'prompt',
      target: 'Review ${file}',
    });

    const persisted = JSON.parse(fs.readFileSync(triggerConfigPath(rootDir), 'utf8')) as unknown[];
    expect(persisted).toHaveLength(1);

    const reloaded = new FileTriggerManager({ rootDir });
    expect(reloaded.listTriggers()).toEqual([
      {
        pattern: 'src/**/*.ts',
        action: 'prompt',
        target: 'Review ${file}',
      },
    ]);
  });

  it('matches glob patterns with recursive directories', () => {
    expect(matchesFileTriggerPattern('src/**/*.ts', 'src/index.ts')).toBe(true);
    expect(matchesFileTriggerPattern('src/**/*.ts', 'src/workflows/file-trigger.ts')).toBe(true);
    expect(matchesFileTriggerPattern('docs/*.md', 'docs/readme.md')).toBe(true);
    expect(matchesFileTriggerPattern('docs/*.md', 'docs/api/readme.md')).toBe(false);
  });

  it('debounces repeated file events and ignores .icopilot files', () => {
    vi.useFakeTimers();
    const watchStub = createWatchStub();
    const manager = new FileTriggerManager({ rootDir, watch: watchStub.watch });
    const callback = vi.fn();

    manager.addTrigger({
      pattern: 'src/**/*.ts',
      action: 'command',
      target: 'npm test -- ${file}',
      debounce: 250,
    });
    manager.onTrigger(callback);
    manager.start(rootDir);

    watchStub.emit('src/index.ts');
    watchStub.emit('src/index.ts');
    watchStub.emit('.icopilot/triggers.json');

    vi.advanceTimersByTime(249);
    expect(callback).not.toHaveBeenCalled();

    vi.advanceTimersByTime(1);
    expect(callback).toHaveBeenCalledTimes(1);
    expect(callback).toHaveBeenCalledWith(
      {
        pattern: 'src/**/*.ts',
        action: 'command',
        target: 'npm test -- ${file}',
        debounce: 250,
      },
      'src/index.ts',
    );

    manager.stop();
    expect(watchStub.close).toHaveBeenCalledTimes(1);
  });
});

describe('slash trigger integration', () => {
  it('adds, lists, and removes triggers via /trigger', async () => {
    const added = await triggerCommand(
      ['add', 'src/**/*.ts', 'prompt', 'Review', '${file}'],
      rootDir,
    );
    const listed = await triggerCommand(['list'], rootDir);
    const removed = await triggerCommand(['remove', 'src/**/*.ts'], rootDir);

    expect(added).toContain('trigger saved');
    expect(listed).toContain('File triggers');
    expect(listed).toContain('src/**/*.ts');
    expect(listed).toContain('prompt:Review ${file}');
    expect(removed).toContain('trigger removed');
  });
});

describe('completion metadata', () => {
  it('includes /trigger in the default slash commands', () => {
    expect(defaultContext().slashCommands).toContain('trigger');
  });
});
