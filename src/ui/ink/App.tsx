import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Box, Static, Text, useApp, useInput, useStdout } from 'ink';
import { AppHeader } from './AppHeader.js';
import { HistoryItem, type HistoryMessage } from './HistoryItem.js';
import { colors } from './theme.js';

// ─── Slash command registry for autocomplete ─────────────────────────────────

const SLASH_COMMANDS = [
  'help','exit','clear','model','mode','provider','context','usage','settings',
  'cwd','diff','changes','git-log','copy','paste','copy-context','history',
  'sessions','run','test','lint','fix','edit-format','auto-lint','auto-test',
  'auto-fix','compact','review','security','audit','explain','explain-shell',
  'shell','web','search','agent','goal','tdd','codegen','doc','diagram',
  'snippets','snippet','template','alias','bookmark','bookmarks','handoff',
  'share','export','stats','cost','tokens','think-tokens','sandbox','role',
  'policy','filter','conventions','style','doctor','env','branch','worktree',
  'commit','stash','undo','todo','todos','task','tasks','schedule','trigger',
  'triggers','watch','voice','acp','batch','compare','deps','feedback',
  'extensions','extension','space','explore','repo','summary','workflow',
  'workflows','trace','stacktrace','retention','validate','generate','suggest',
  'route','serve','status','start','stop','skill','team-memory',
].sort();

const SPINNER_FRAMES = ['⠋','⠙','⠹','⠸','⠼','⠴','⠦','⠧','⠇','⠏'];

// ─── Public handle exposed to tui.ts ─────────────────────────────────────────

export interface TuiHandle {
  /** Add a fully-completed message to the frozen history. */
  addCompleted: (msg: HistoryMessage) => void;
  /** Append streaming text to the live (non-Static) response. */
  appendLive: (text: string) => void;
  /** Finalize the live response: move it to completed history. */
  finishLive: (finalContent: string) => void;
  /** Signal busy state without creating a history item. */
  setBusy: (b: boolean) => void;
  setTokenCount: (n: number) => void;
  setFollowups: (chips: string[]) => void;
  notify: (text: string, level?: 'info' | 'warn' | 'error') => void;
}

// ─── App props ────────────────────────────────────────────────────────────────

export interface AppCallbacks {
  onLine: (line: string) => Promise<void>;
  onCancel: () => void;
  onExit: () => void;
}

export interface AppState {
  model: string;
  provider: string;
  branch: string;
  cwd: string;
  version: string;
}

interface AppProps {
  appState: AppState;
  callbacks: AppCallbacks;
  registerHandle: (h: TuiHandle) => void;
}

// ─── Notification banner ──────────────────────────────────────────────────────

interface Notification {
  text: string;
  level: 'info' | 'warn' | 'error';
  id: number;
}

// ─── App ─────────────────────────────────────────────────────────────────────

export function App({ appState, callbacks, registerHandle }: AppProps): React.ReactElement {
  const { exit } = useApp();
  const { stdout } = useStdout();
  const cols = stdout.columns || 80;

  // ── Completed (frozen) history — only grows, never mutates ──────────────
  const [completedHistory, setCompletedHistory] = useState<HistoryMessage[]>([]);

  // ── Live streaming response (outside Static, truly reactive) ────────────
  const [liveContent, setLiveContent] = useState('');
  const [busy, setBusyState] = useState(false);

  // ── Input ────────────────────────────────────────────────────────────────
  const [inputBuffer, setInputBuffer] = useState('');

  // ── Followup chips ────────────────────────────────────────────────────────
  const [followups, setFollowupsState] = useState<string[]>([]);
  const [followupIndex, setFollowupIndex] = useState(0);

  // ── Slash autocomplete ────────────────────────────────────────────────────
  const slashSuggestions =
    inputBuffer.startsWith('/') && !inputBuffer.includes(' ')
      ? SLASH_COMMANDS.filter((c) => c.startsWith(inputBuffer.slice(1))).slice(0, 8)
      : [];
  const [slashIndex, setSlashIndex] = useState(0);

  // ── Spinner ───────────────────────────────────────────────────────────────
  const [spinnerFrame, setSpinnerFrame] = useState(0);

  // ── Notifications ─────────────────────────────────────────────────────────
  const [notifications, setNotifications] = useState<Notification[]>([]);
  const notifSeq = useRef(0);

  // ── Token count ───────────────────────────────────────────────────────────
  const [tokenCount, setTokenCountState] = useState(0);

  // Refs for use inside async closures
  const busyRef = useRef(false);

  // ── Spinner animation ─────────────────────────────────────────────────────
  useEffect(() => {
    if (!busy) return;
    const t = setInterval(() => setSpinnerFrame((f) => f + 1), 80);
    return () => clearInterval(t);
  }, [busy]);

  // ── Auto-dismiss notifications ────────────────────────────────────────────
  const addNotification = useCallback(
    (text: string, level: 'info' | 'warn' | 'error' = 'info') => {
      const id = ++notifSeq.current;
      setNotifications((prev) => [...prev, { text, level, id }]);
      setTimeout(() => setNotifications((prev) => prev.filter((n) => n.id !== id)), 5000);
    },
    [],
  );

  // ── Reset slash index when suggestions change ─────────────────────────────
  useEffect(() => { setSlashIndex(0); }, [inputBuffer]);

  // ── Register handle ───────────────────────────────────────────────────────
  useEffect(() => {
    const handle: TuiHandle = {
      addCompleted(msg) {
        setCompletedHistory((prev) => [...prev, msg]);
      },
      appendLive(text) {
        setLiveContent((prev) => prev + text);
      },
      finishLive(finalContent) {
        if (finalContent.trim()) {
          setCompletedHistory((prev) => [
            ...prev,
            { id: `copilot-${Date.now()}`, role: 'copilot', content: finalContent },
          ]);
        }
        setLiveContent('');
      },
      setBusy(b) {
        busyRef.current = b;
        setBusyState(b);
        if (!b) setLiveContent('');
      },
      setTokenCount: setTokenCountState,
      setFollowups(chips) {
        setFollowupsState(chips);
        setFollowupIndex(0);
      },
      notify: addNotification,
    };
    registerHandle(handle);
  }, [registerHandle, addNotification]);

  // ── Submit a line ─────────────────────────────────────────────────────────
  const submitLine = useCallback(
    (line: string) => {
      setInputBuffer('');
      setFollowupsState([]);
      setFollowupIndex(0);
      void callbacks.onLine(line);
    },
    [callbacks],
  );

  // ── Keyboard ──────────────────────────────────────────────────────────────
  useInput((input, key) => {
    // Ctrl+C
    if (key.ctrl && (input === 'c' || input === '\x03')) {
      if (busyRef.current) { callbacks.onCancel(); return; }
      callbacks.onExit();
      exit();
      return;
    }

    if (busy) return;

    // Enter
    if (key.return) {
      // Slash autocomplete selection
      if (slashSuggestions.length && inputBuffer.startsWith('/') && !inputBuffer.includes(' ')) {
        const chosen = slashSuggestions[slashIndex];
        if (chosen) { setInputBuffer(`/${chosen} `); return; }
      }
      // Followup chip
      if (!inputBuffer.trim() && followups.length) {
        const idx = ((followupIndex % followups.length) + followups.length) % followups.length;
        submitLine(followups[idx] ?? '');
        return;
      }
      if (inputBuffer.trim()) { submitLine(inputBuffer); }
      return;
    }

    // Tab — autocomplete
    if (key.tab && slashSuggestions.length) {
      const chosen = slashSuggestions[slashIndex];
      if (chosen) { setInputBuffer(`/${chosen} `); }
      return;
    }

    // Backspace / Delete
    if (key.backspace || key.delete) {
      setInputBuffer((b) => b.slice(0, -1));
      return;
    }

    // Ctrl+U — clear line
    if (key.ctrl && (input === 'u' || input === '\x15')) {
      setInputBuffer('');
      return;
    }

    // Ctrl+W — delete word
    if (key.ctrl && (input === 'w' || input === '\x17')) {
      setInputBuffer((b) => b.replace(/\S+\s*$/, ''));
      return;
    }

    // Arrow up/down — navigate slash suggestions or followup chips
    if (key.upArrow) {
      if (slashSuggestions.length) {
        setSlashIndex((i) => (i - 1 + slashSuggestions.length) % slashSuggestions.length);
      } else if (followups.length) {
        setFollowupIndex((i) => (i - 1 + followups.length) % followups.length);
      }
      return;
    }
    if (key.downArrow) {
      if (slashSuggestions.length) {
        setSlashIndex((i) => (i + 1) % slashSuggestions.length);
      } else if (followups.length) {
        setFollowupIndex((i) => (i + 1) % followups.length);
      }
      return;
    }

    // Ctrl+N/P — followup cycle
    if (key.ctrl && (input === 'n' || input === '\x0e') && followups.length) {
      setFollowupIndex((i) => (i + 1) % followups.length); return;
    }
    if (key.ctrl && (input === 'p' || input === '\x10') && followups.length) {
      setFollowupIndex((i) => (i - 1 + followups.length) % followups.length); return;
    }

    // Escape — clear suggestions
    if (key.escape) {
      setFollowupsState([]); setFollowupIndex(0); return;
    }

    // Regular character
    if (input && !key.ctrl && !key.meta) {
      setInputBuffer((b) => b + input);
    }
  });

  // ─── Footer bar content ───────────────────────────────────────────────────
  const tokenPart = tokenCount > 0 ? `  ·  ~${Math.round(tokenCount / 1000)}k ctx` : '';
  const branchPart = appState.branch ? `  \uE0A0 ${appState.branch}` : '';
  const footerRight = `${appState.model}${tokenPart}`;
  const footerLeft = appState.cwd + branchPart;
  const footerGap = Math.max(1, cols - footerLeft.length - footerRight.length - 2);

  const spinnerIcon = SPINNER_FRAMES[spinnerFrame % SPINNER_FRAMES.length] ?? '⠋';

  // ─── Render ───────────────────────────────────────────────────────────────
  return (
    <Box flexDirection="column" width="100%">

      {/* ═══ FROZEN HISTORY (Static prints once, stacks upward) ════════════ */}
      <Static
        items={[
          { id: '__header__', type: 'header' as const },
          ...completedHistory.map((m) => ({ id: m.id, type: 'msg' as const, msg: m })),
        ]}
      >
        {(item) =>
          item.type === 'header' ? (
            <AppHeader key="header" {...appState} />
          ) : (
            <HistoryItem key={item.id} message={item.msg} terminalWidth={cols} />
          )
        }
      </Static>

      {/* ═══ LIVE: streaming response (mutates every chunk) ════════════════ */}
      {(busy || liveContent.trim()) && (
        <Box flexDirection="column" width="100%">
          <Box>
            <Text color={colors.separator}>{'─'.repeat(cols)}</Text>
          </Box>
          <Box paddingX={1}>
            <Text bold color={colors.copilot}>{'● '}</Text>
            <Text bold>Copilot</Text>
          </Box>
          {liveContent.trim() ? (
            <Box paddingX={2} paddingBottom={busy ? 0 : 1}>
              <Text>{liveContent}</Text>
            </Box>
          ) : null}
          {busy && (
            <Box paddingX={2} paddingBottom={1}>
              <Text color={colors.muted}>{`${spinnerIcon} `}</Text>
              <Text dimColor>Thinking…</Text>
            </Box>
          )}
        </Box>
      )}

      {/* ═══ NOTIFICATIONS ══════════════════════════════════════════════════ */}
      {notifications.map((n) => (
        <Box
          key={n.id}
          paddingX={2}
          borderStyle="round"
          borderColor={n.level === 'error' ? colors.error : n.level === 'warn' ? colors.warning : colors.brand}
        >
          <Text
            color={n.level === 'error' ? colors.error : n.level === 'warn' ? colors.warning : colors.brand}
          >
            {n.level === 'error' ? '✖ ' : n.level === 'warn' ? '⚠ ' : 'ℹ '}{n.text}
          </Text>
        </Box>
      ))}

      {/* ═══ FOLLOWUP CHIPS ═════════════════════════════════════════════════ */}
      {!busy && followups.length > 0 && (
        <Box flexDirection="column" paddingX={1}>
          <Box>
            <Text dimColor>Next steps:  </Text>
            {followups.map((c, i) => (
              <React.Fragment key={c}>
                {i > 0 && <Text>{'  '}</Text>}
                <Text bold={i === followupIndex} color={i === followupIndex ? colors.success : colors.muted}>
                  {`[${c}]`}
                </Text>
              </React.Fragment>
            ))}
          </Box>
          <Box paddingLeft={1}>
            <Text dimColor>{'↵ run  ↑↓ cycle  Esc dismiss'}</Text>
          </Box>
        </Box>
      )}

      {/* ═══ SLASH AUTOCOMPLETE ══════════════════════════════════════════════ */}
      {slashSuggestions.length > 0 && (
        <Box flexDirection="column" paddingX={2} marginBottom={0}>
          <Box>
            <Text color={colors.slash} dimColor>{'Commands:'}</Text>
          </Box>
          {slashSuggestions.map((cmd, i) => (
            <Box key={cmd} paddingLeft={1}>
              <Text bold={i === slashIndex} color={i === slashIndex ? colors.slash : colors.muted}>
                {i === slashIndex ? '▶ ' : '  '}
              </Text>
              <Text bold={i === slashIndex} color={i === slashIndex ? colors.slash : colors.muted}>
                {'/' + cmd}
              </Text>
            </Box>
          ))}
          <Box paddingLeft={1}>
            <Text dimColor>{'↑↓ navigate  ↵/Tab select'}</Text>
          </Box>
        </Box>
      )}

      {/* ═══ COMPOSER ═══════════════════════════════════════════════════════ */}
      <Box>
        <Text color={colors.accent}>{'▄'.repeat(cols)}</Text>
      </Box>
      <Box paddingX={1}>
        {busy
          ? <Text color={colors.warning}>{'◆ '}</Text>
          : <Text bold color={colors.success}>{'❯ '}</Text>
        }
        <Text>{inputBuffer}</Text>
        {!busy && <Text inverse>{' '}</Text>}
        {busy && <Text dimColor>{' (working…)'}</Text>}
      </Box>
      <Box>
        <Text color={colors.separator}>{'▀'.repeat(cols)}</Text>
      </Box>

      {/* ═══ STATUS FOOTER ══════════════════════════════════════════════════ */}
      <Box paddingX={1}>
        <Text color={colors.muted}>{footerLeft}</Text>
        <Text>{' '.repeat(Math.max(0, footerGap))}</Text>
        <Text color={colors.muted}>{footerRight}</Text>
      </Box>

    </Box>
  );
}
