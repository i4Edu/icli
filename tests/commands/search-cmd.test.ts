import { afterEach, describe, expect, it, vi } from 'vitest';
import { searchCommand } from '../../src/commands/search-cmd.js';

const { searchIndexMock } = vi.hoisted(() => ({
  searchIndexMock: vi.fn(),
}));

vi.mock('../../src/index/store.js', () => ({
  searchIndex: searchIndexMock,
}));

describe('searchCommand', () => {
  afterEach(() => {
    vi.clearAllMocks();
  });

  it('returns usage help when query is empty', async () => {
    await expect(searchCommand([], 'E:\\AI\\icli')).resolves.toContain('usage: /search <query>');
    expect(searchIndexMock).not.toHaveBeenCalled();
  });

  it('returns a helpful message when the index is not available', async () => {
    searchIndexMock.mockRejectedValueOnce(
      Object.assign(new Error('No index found'), { code: 'ENOENT' }),
    );

    await expect(searchCommand(['refactor', 'router'], 'E:\\AI\\icli')).resolves.toContain(
      'No index found. Run `/index build` first.',
    );
  });
});
