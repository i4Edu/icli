import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { config } from '../../src/config.js';
import type { Session } from '../../src/session/session.js';

const compactSessionMock = vi.fn();

vi.mock('../../src/context/compactor.js', () => ({
  compactSession: compactSessionMock,
}));

describe('handlePostTurnContextBudget', () => {
  let stdoutSpy: ReturnType<typeof vi.spyOn>;
  let originalAutoCompact: boolean;
  let originalContextWindow: number;
  let originalAutoCompactThreshold: number;
  let output = '';

  beforeEach(() => {
    originalAutoCompact = config.autoCompact;
    originalContextWindow = config.contextWindow;
    originalAutoCompactThreshold = config.autoCompactThreshold;
    config.autoCompact = true;
    config.contextWindow = 100;
    config.autoCompactThreshold = 0.95;
    output = '';
    compactSessionMock.mockResolvedValue('compacted summary');
    stdoutSpy = vi
      .spyOn(process.stdout, 'write')
      .mockImplementation((chunk: string | Uint8Array) => {
        output += String(chunk);
        return true;
      });
  });

  afterEach(() => {
    stdoutSpy.mockRestore();
    config.autoCompact = originalAutoCompact;
    config.contextWindow = originalContextWindow;
    config.autoCompactThreshold = originalAutoCompactThreshold;
    vi.clearAllMocks();
  });

  it('auto-compacts when usage exceeds the threshold', async () => {
    const compactInto = vi.fn();
    const session = {
      tokenUsage: vi.fn().mockReturnValueOnce(96).mockReturnValueOnce(24),
      compactInto,
    } as unknown as Session;
    const signal = new AbortController().signal;

    const { handlePostTurnContextBudget } = await import('../../src/modes/auto-compact.js');

    await expect(handlePostTurnContextBudget(session, signal)).resolves.toBe(true);
    expect(compactSessionMock).toHaveBeenCalledWith(session, signal);
    expect(compactInto).toHaveBeenCalledWith('compacted summary');
    expect(output).toContain('⚡ auto-compacting context (96% full)...');
    expect(output).toContain('✔ auto-compacted. Freed 72 tokens.');
  });
});
