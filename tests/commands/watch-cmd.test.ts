import { beforeEach, describe, expect, it } from 'vitest';
import {
  formatWatchStatus,
  parseWatchArgs,
  watchCommand,
  type WatchState,
} from '../../src/commands/watch-cmd.js';

describe('watch-cmd', () => {
  beforeEach(() => {
    watchCommand(['stop']);
  });

  it('parses a valid pattern and command', () => {
    expect(parseWatchArgs(['src/**/*.ts', 'npm', 'test'])).toEqual({
      pattern: 'src/**/*.ts',
      command: 'npm test',
      debounceMs: 500,
    });
  });

  it('returns an error for missing args', () => {
    expect(parseWatchArgs(['src/**/*.ts'])).toEqual({
      error: 'usage: /watch set <pattern> <command>',
    });
  });

  it('formats active and inactive watch state', () => {
    const activeState: WatchState = {
      active: true,
      pattern: 'src/**/*.ts',
      command: 'npm test',
      triggerCount: 3,
    };
    const inactiveState: WatchState = {
      ...activeState,
      active: false,
      triggerCount: 4,
    };

    expect(formatWatchStatus(activeState)).toContain('active:        yes');
    expect(formatWatchStatus(activeState)).toContain('trigger count: 3');
    expect(formatWatchStatus(inactiveState)).toContain('active:        no');
    expect(formatWatchStatus(inactiveState)).toContain('trigger count: 4');
  });

  it('shows usage and current state with no args', () => {
    const output = watchCommand([]);

    expect(output).toContain('Watch command');
    expect(output).toContain('/watch set <pattern> <command>');
    expect(output).toContain('No watch configured.');
  });

  it('configures a watch with set', () => {
    const output = watchCommand(['set', 'src/**/*.ts', 'npm', 'test']);

    expect(output).toContain('watch configured');
    expect(output).toContain('pattern:       src/**/*.ts');
    expect(output).toContain('command:       npm test');
    expect(output).toContain('debounce:      500ms');
  });

  it('stops an active watch', () => {
    watchCommand(['set', 'src/**/*.ts', 'npm', 'test']);

    const output = watchCommand(['stop']);

    expect(output).toContain('watch stopped');
    expect(output).toContain('active:        no');
  });

  it('shows the current watch status', () => {
    watchCommand(['set', 'src/**/*.ts', 'npm', 'test']);

    const output = watchCommand(['status']);

    expect(output).toContain('Watch status');
    expect(output).toContain('pattern:       src/**/*.ts');
    expect(output).toContain('command:       npm test');
    expect(output).toContain('trigger count: 0');
  });
});
