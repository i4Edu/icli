import { describe, expect, it } from 'vitest';
import {
  WORKSPACE_TABS,
  renderTabBar,
  renderHero,
  renderStatusDock,
  magentaSeparator,
  renderFooter,
  renderHeaderBar,
  renderContextPanel,
  composeColumns,
  renderFollowups,
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

  it('shows only the right side when it alone fills the terminal width', () => {
    const right = 'x'.repeat(COLS);
    const dock = renderStatusDock('left', right, COLS);
    expect(visibleWidth(dock)).toBe(COLS);
    expect(stripAnsi(dock)).toBe(right);
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

  it('advertises the follow-up navigation keys', () => {
    const footer = stripAnsi(renderFooter(160));
    expect(footer).toContain('[Ctrl+N/Ctrl+P] Cycle Follow-ups');
    expect(footer).toContain('[Esc] Clear');
  });
});

describe('renderHeaderBar', () => {
  it('left-aligns the title and right-aligns the status cluster', () => {
    const bar = renderHeaderBar(
      { online: true, mode: 'ask', model: 'gpt-4o-mini', sessionId: 'abcdef123456' },
      COLS,
    );
    const plain = stripAnsi(bar);
    expect(visibleWidth(bar)).toBe(COLS);
    expect(plain.startsWith('iCopilot CLI')).toBe(true);
    expect(plain).toContain('online');
    expect(plain).toContain('ask');
    expect(plain).toContain('gpt-4o-mini');
    expect(plain.trimEnd().endsWith('#abcdef')).toBe(true);
  });

  it('reports offline status', () => {
    const plain = stripAnsi(
      renderHeaderBar({ online: false, mode: 'plan', model: 'm', sessionId: 'x' }, COLS),
    );
    expect(plain).toContain('offline');
  });
});

describe('renderContextPanel', () => {
  it('renders session and recent sections padded to the panel geometry', () => {
    const lines = renderContextPanel(
      {
        sessionId: 'sess1234',
        model: 'gpt-4o-mini',
        mode: 'ask',
        cwd: '/workspaces/icli',
        branch: 'main',
        recentCommands: ['check speed', 'compare plans'],
      },
      28,
      14,
    );
    expect(lines).toHaveLength(14);
    for (const line of lines) expect(visibleWidth(line)).toBe(28);
    const plain = lines.map(stripAnsi).join('\n');
    expect(plain).toContain('Session');
    expect(plain).toContain('Recent');
    expect(plain).toContain('main');
    // Most-recent command is listed first.
    expect(plain).toContain('compare plans');
  });

  it('shows a placeholder when there are no recent commands', () => {
    const lines = renderContextPanel(
      { sessionId: 's', model: 'm', mode: 'ask', cwd: '/tmp', recentCommands: [] },
      24,
      10,
    );
    expect(lines.map(stripAnsi).join('\n')).toContain('(no commands yet)');
  });
});

describe('composeColumns', () => {
  it('joins both columns with an aligned vertical divider', () => {
    const rows = composeColumns(['left'], ['right'], 10, 8, 3);
    expect(rows).toHaveLength(3);
    for (const row of rows) {
      expect(visibleWidth(row)).toBe(10 + 3 + 8); // left + ' | ' + right
      expect(stripAnsi(row)).toContain('│');
    }
    expect(stripAnsi(rows[0]).startsWith('left')).toBe(true);
    expect(stripAnsi(rows[0]).endsWith('right   ')).toBe(true);
  });
});

describe('renderFollowups', () => {
  it('renders chips and brightens the active one', () => {
    const line = renderFollowups(['diagnose network', 'optimize config'], 1, COLS);
    const plain = stripAnsi(line);
    expect(plain).toContain('[diagnose network]');
    expect(plain).toContain('[optimize config]');
    expect(plain).toContain('next:');
    // Active chip (index 1) carries the bright/green styling.
    expect(line).toContain('\x1b[32m[optimize config]');
  });

  it('returns an empty string with no items', () => {
    expect(renderFollowups([], 0, COLS)).toBe('');
  });

  it('wraps the active index into range', () => {
    const line = renderFollowups(['a', 'b'], 5, COLS);
    expect(stripAnsi(line)).toContain('[a]');
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
