import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Session } from '../../src/session/session.js';

const { checkIsRepoMock, diffMock, rawMock, simpleGitMock } = vi.hoisted(() => {
  const checkIsRepo = vi.fn();
  const diff = vi.fn();
  const raw = vi.fn();
  const simpleGit = vi.fn(() => ({
    checkIsRepo,
    diff,
    raw,
  }));
  return {
    checkIsRepoMock: checkIsRepo,
    diffMock: diff,
    rawMock: raw,
    simpleGitMock: simpleGit,
  };
});

vi.mock('simple-git', () => ({
  default: simpleGitMock,
}));

import {
  ensureChangeTracking,
  recordTurnSnapshot,
  showChangesSinceLastTurn,
  showChangesSinceMessage,
  showChangesSinceSessionStart,
} from '../../src/commands/changes-cmd.js';

describe('changes-cmd', () => {
  beforeEach(() => {
    simpleGitMock.mockClear();
    checkIsRepoMock.mockReset();
    diffMock.mockReset();
    rawMock.mockReset();
    checkIsRepoMock.mockResolvedValue(true);
    diffMock.mockResolvedValue('diff --git a/src/app.ts b/src/app.ts\n@@ -1 +1 @@\n-old\n+new');
  });

  it('tracks a baseline snapshot and formats changes since session start', async () => {
    rawMock.mockResolvedValueOnce('base-ref');
    const session = createSession();

    await ensureChangeTracking(session);
    const output = await showChangesSinceSessionStart(session);

    expect(rawMock).toHaveBeenCalledWith(['stash', 'create', 'icli-turn-snapshot']);
    expect(diffMock).toHaveBeenCalledWith(['base-ref']);
    expect(output).toContain('Changes since session start:');
    expect(output).toContain('+new');
    expect(session.state.changeTracking?.sessionStartRef).toBe('base-ref');
  });

  it('records per-turn snapshots and supports no-arg last-turn lookup', async () => {
    rawMock.mockResolvedValueOnce('base-ref').mockResolvedValueOnce('turn-ref');
    const session = createSession([{ role: 'assistant', content: 'done' }]);

    await recordTurnSnapshot(session);
    const output = await showChangesSinceLastTurn();

    expect(diffMock).toHaveBeenCalledWith(['turn-ref']);
    expect(output).toContain('Changes since AI turn 2:');
    expect(session.state.changeTracking?.turnSnapshots).toEqual([
      expect.objectContaining({ turnIndex: 1, ref: 'turn-ref' }),
    ]);
  });

  it('shows changes from a specific recorded turn', async () => {
    const session = createSession([
      { role: 'assistant', content: 'first' },
      { role: 'assistant', content: 'second' },
    ]);

    const output = await showChangesSinceMessage(0, sessionFromSnapshots(session));

    expect(output).toContain('Changes since AI turn 1:');
    expect(diffMock).toHaveBeenCalledWith(['turn-0']);
  });

  it('returns helpful empty and missing-snapshot messages', async () => {
    rawMock.mockResolvedValueOnce('');
    diffMock.mockResolvedValueOnce('');
    const session = createSession();

    await ensureChangeTracking(session);
    await expect(showChangesSinceLastTurn(session)).resolves.toContain(
      'No AI turns have been recorded yet.',
    );
    await expect(showChangesSinceMessage(3, session)).resolves.toContain(
      'No snapshot recorded for AI turn 4.',
    );
    await expect(showChangesSinceSessionStart(session)).resolves.toContain(
      'No uncommitted changes since session start.',
    );
  });
});

function createSession(messages: Array<{ role: string; content: string }> = []): Session {
  return {
    state: {
      id: 'session-1',
      createdAt: new Date().toISOString(),
      model: 'gpt-test',
      mode: 'ask',
      cwd: process.cwd(),
      messages,
      todos: [],
      pinned: [],
      gitContext: [],
      changeTracking: undefined,
    },
    persist: vi.fn(),
  } as unknown as Session;
}

function sessionFromSnapshots(session: Session): Session {
  session.state.changeTracking = {
    sessionStartRef: 'base-ref',
    sessionStartAt: new Date().toISOString(),
    turnSnapshots: [
      { turnIndex: 0, ref: 'turn-0', createdAt: new Date().toISOString() },
      { turnIndex: 1, ref: 'turn-1', createdAt: new Date().toISOString() },
    ],
  };
  return session;
}
