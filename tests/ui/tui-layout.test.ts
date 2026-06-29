import { describe, expect, it } from 'vitest';
import {
  WORKSPACE_TABS,
  renderTabBar,
  renderHero,
  renderStatusDock,
  magentaSeparator,
  renderFooter,
  parseSlashCommand,
  stripAnsi,
  visibleWidth,
  padVisible,
} from '../../src/ui/tui-layout.js';

const COLS = 80;

describe('padVisible', () => {
  it('pads short strings to the exact visible width', () => {
    expect(visibleWidth(padVisible('hi', COLS))).toBe(COLS);
  });

  it('measures width ignoring ANSI escapes', () => {
    expect(visibleWidth('\x1b[44mhello\x1b[0m')).toBe(5);
  });

  it('clips over-long strings to the column width', () => {
    expect(padVisible('x'.repeat(120), COLS)).toHaveLength(COLS);
  });
});

describe('renderTabBar', () => {
  it('spans the full width on the deep-blue track', () => {
    const bar = renderTabBar(0, COLS);
    expect(bar).toContain('\x1b[44m');
    expect(visibleWidth(bar)).toBe(COLS);
  });

  it('brackets only the active tab', () => {
    const plain = stripAnsi(renderTabBar(1, COLS));
    expect(plain).toContain(`[${WORKSPACE_TABS[1]}]`);
    expect(plain).toContain(` ${WORKSPACE_TABS[0]} `);
    expect(plain).not.toContain(`[${WORKSPACE_TABS[0]}]`);
  });

  it('wraps the active index into range', () => {
    const plain = stripAnsi(renderTabBar(WORKSPACE_TABS.length, COLS));
    expect(plain).toContain(`[${WORKSPACE_TABS[0]}]`);
  });

  it('all tab labels are present', () => {
    const plain = stripAnsi(renderTabBar(0, COLS));
    for (const tab of WORKSPACE_TABS) {
      expect(plain).toContain(tab);
    }
  });
});

describe('renderHero', () => {
  it('renders branding, experimental and tip bulletins', () => {
    const lines = renderHero(
      {
        version: '1.0.0',
        provider: 'GitHub Models',
        experimental: '/experimental [Active]',
        tips: ['Tip one', 'Tip two'],
      },
      COLS,
    );
    const plain = lines.map(stripAnsi).join('\n');
    expect(plain).toContain('iCopilot CLI Agent v1.0.0');
    expect(plain).toContain('Provider: GitHub Models');
    expect(plain).toContain('Experimental Capabilities: /experimental [Active]');
    expect(plain).toContain('● Tip one');
    expect(plain).toContain('● Tip two');
  });

  it('pads every line to the column width', () => {
    const lines = renderHero({ version: '1', provider: 'p', tips: ['a'] }, COLS);
    for (const line of lines) {
      expect(visibleWidth(line)).toBe(COLS);
    }
  });
});

describe('renderStatusDock', () => {
  it('left-aligns the left context and right-aligns the right context', () => {
    const dock = renderStatusDock('/repo [main]', 'Usage: 4/1000', COLS);
    expect(visibleWidth(dock)).toBe(COLS);
    expect(stripAnsi(dock).startsWith('/repo [main]')).toBe(true);
    expect(stripAnsi(dock).endsWith('Usage: 4/1000')).toBe(true);
  });

  it('clips the left context when the row would overflow', () => {
    const dock = renderStatusDock('/very/long/path'.repeat(20), 'Usage: 4/1000 credits', COLS);
    expect(visibleWidth(dock)).toBeLessThanOrEqual(COLS);
    expect(stripAnsi(dock).endsWith('Usage: 4/1000 credits')).toBe(true);
  });
});

describe('magentaSeparator', () => {
  it('is a full-width magenta line', () => {
    const sep = magentaSeparator(COLS);
    expect(sep).toContain('\x1b[35m');
    expect(stripAnsi(sep)).toBe('─'.repeat(COLS));
  });
});

describe('renderFooter', () => {
  it('contains the persistent keybinding legend', () => {
    const footer = stripAnsi(renderFooter(120));
    expect(footer).toContain('[Ctrl+C] Quit');
    expect(footer).toContain('[PageUp/Down] Scroll Output');
    expect(footer).toContain('[/] System Commands');
    expect(footer).toContain('[@] Target Context');
  });
});

describe('parseSlashCommand', () => {
  it('splits on whitespace thresholds rather than fixed slices', () => {
    expect(parseSlashCommand('/model gpt-4o')).toEqual({ command: 'model', args: ['gpt-4o'] });
    expect(parseSlashCommand('  /theme   high-contrast ')).toEqual({
      command: 'theme',
      args: ['high-contrast'],
    });
    expect(parseSlashCommand('/skills')).toEqual({ command: 'skills', args: [] });
  });

  it('returns null for non-slash input', () => {
    expect(parseSlashCommand('hello world')).toBeNull();
    expect(parseSlashCommand('/')).toBeNull();
  });
});
