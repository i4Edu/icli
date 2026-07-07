import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Box, Static, Text, useApp, useInput, useStdout } from 'ink';
import { AppHeader } from './AppHeader.js';
import { HistoryItem, type HistoryMessage } from './HistoryItem.js';
import { colors } from './theme.js';

// ─── Slash command registry for autocomplete ─────────────────────────────────

const SLASH_COMMANDS = [
  // core
  'help','exit','quit','clear','new','reset','model','mode','provider',
  'context','usage','settings','cwd','cd','diff','changes','git-log','copy',
  'paste','copy-context','history','sessions','resume','continue','session',
  'rename','restart','run','test','lint','fix','edit-format','auto-lint',
  'auto-test','auto-fix','compact','review','security','audit','explain',
  'explain-shell','shell','web','search','agent','goal','tdd','codegen','doc',
  'diagram','snippets','snippet','template','alias','bookmark','bookmarks',
  'handoff','share','export','stats','cost','tokens','think-tokens','sandbox',
  'role','policy','filter','conventions','style','doctor','env','branch',
  'worktree','commit','stash','undo','todo','todos','task','tasks','schedule',
  'trigger','triggers','watch','voice','acp','mcp','batch','compare','deps',
  'feedback','bug','extensions','extension','space','explore','repo','summary',
  'workflow','workflows','trace','stacktrace','retention','generate','suggest',
  'route','serve','skill','skills','team-memory','fleet','parallel',
  // tui.md parity
  'add-dir','allow-all','app','chronicle','clikit','delegate','downgrade',
  'experimental','fleet','ide','instructions','keep-alive','caffeinate',
  'list-dirs','login','logout','lsp','permissions','remote','research',
  'reset-allowed-tools','rubber-duck','streamer-mode','terminal-setup',
  'theme','update','user','plan','autopilot','diff-review','index','rag',
  'goto','refs','read-only','ro','pin','unpin','every','after','editor',
  'reasoning','cloud','cloud-routine','bridge','error-watch','memory',
  'corrections','readme','changelog','release','heal','dead-code','refactor',
  'metrics','notify','actions','multi','init','proxy','retention','plugin',
  'plugins','worktree','acp','serve',
].filter((v,i,a)=>a.indexOf(v)===i).sort();

const SPINNER_FRAMES = ['⠋','⠙','⠹','⠸','⠼','⠴','⠦','⠧','⠇','⠏'];

// ─── Mode type ────────────────────────────────────────────────────────────────

export type TuiMode = 'ask' | 'plan' | 'autopilot';

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
  setMode: (mode: TuiMode) => void;
}

// ─── App props ────────────────────────────────────────────────────────────────

export interface AppCallbacks {
  onLine: (line: string) => Promise<void>;
  onCancel: () => void;
  onExit: () => void;
  onModeChange?: (mode: TuiMode) => void;
}

export interface AppState {
  model: string;
  provider: string;
  branch: string;
  cwd: string;
  version: string;
  initialMode?: TuiMode;
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

// ─── Word movement helpers ────────────────────────────────────────────────────

function nextWordEnd(s: string, pos: number): number {
  let i = pos;
  while (i < s.length && s[i] === ' ') i++;
  while (i < s.length && s[i] !== ' ') i++;
  return i;
}

function prevWordStart(s: string, pos: number): number {
  let i = pos;
  while (i > 0 && s[i - 1] === ' ') i--;
  while (i > 0 && s[i - 1] !== ' ') i--;
  return i;
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

  // ── Input with cursor position ────────────────────────────────────────────
  const [inputBuffer, setInputBuffer] = useState('');
  const [cursorPos, setCursorPos] = useState(0);

  // ── Input history ─────────────────────────────────────────────────────────
  const [inputHistory, setInputHistory] = useState<string[]>([]);
  const [historyIndex, setHistoryIndex] = useState(-1);
  const [savedInput, setSavedInput] = useState('');

  // ── Mode ──────────────────────────────────────────────────────────────────
  const [mode, setModeState] = useState<TuiMode>(appState.initialMode ?? 'ask');

  // ── Reasoning toggle ──────────────────────────────────────────────────────
  const [showReasoning, setShowReasoning] = useState(false);

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
  const inputBufferRef = useRef('');
  const cursorPosRef = useRef(0);

  // Keep refs in sync
  useEffect(() => { inputBufferRef.current = inputBuffer; }, [inputBuffer]);
  useEffect(() => { cursorPosRef.current = cursorPos; }, [cursorPos]);

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
      setMode(m) { setModeState(m); },
    };
    registerHandle(handle);
  }, [registerHandle, addNotification]);

  // ── Submit a line ─────────────────────────────────────────────────────────
  const submitLine = useCallback(
    (line: string, preserveBuffer = false) => {
      // Prepend to history (max 500), reset navigation
      setInputHistory((prev) => [line, ...prev].slice(0, 500));
      setHistoryIndex(-1);
      setSavedInput('');
      if (!preserveBuffer) {
        setInputBuffer('');
        setCursorPos(0);
        setFollowupsState([]);
        setFollowupIndex(0);
      }
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

    // Ctrl+D — exit
    if (key.ctrl && (input === 'd' || input === '\x04')) {
      callbacks.onExit();
      exit();
      return;
    }

    // Ctrl+L — clear screen
    if (key.ctrl && (input === 'l' || input === '\x0c')) {
      process.stdout.write('\x1b[2J\x1b[H');
      return;
    }

    // Shift+Tab — mode cycling (\x1b[Z)
    if ((key.shift && key.tab) || input === '\x1b[Z') {
      const modes: TuiMode[] = ['ask', 'plan', 'autopilot'];
      const next = modes[(modes.indexOf(mode) + 1) % modes.length];
      setModeState(next);
      callbacks.onModeChange?.(next);
      addNotification(`Mode: ${next}`, 'info');
      return;
    }

    // Ctrl+T — toggle reasoning
    if (key.ctrl && (input === 't' || input === '\x14')) {
      setShowReasoning((r) => !r);
      return;
    }

    // Navigation shortcuts work even when busy
    if (key.ctrl && (input === 'a' || input === '\x01')) {
      setCursorPos(0); return;
    }
    if (key.ctrl && (input === 'e' || input === '\x05')) {
      setCursorPos(inputBufferRef.current.length); return;
    }

    if (busy) return;

    // Enter
    if (key.return) {
      // Slash autocomplete selection
      if (slashSuggestions.length && inputBuffer.startsWith('/') && !inputBuffer.includes(' ')) {
        const chosen = slashSuggestions[slashIndex];
        if (chosen) {
          const val = `/${chosen} `;
          setInputBuffer(val);
          setCursorPos(val.length);
          return;
        }
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
      if (chosen) {
        const val = `/${chosen} `;
        setInputBuffer(val);
        setCursorPos(val.length);
      }
      return;
    }

    // Ctrl+S — run but preserve input buffer
    if (key.ctrl && (input === 's' || input === '\x13')) {
      if (inputBuffer.trim()) {
        void callbacks.onLine(inputBuffer);
      }
      return;
    }

    // Backspace / Delete — respect cursor position
    if (key.backspace || key.delete) {
      if (cursorPos > 0) {
        setInputBuffer((b) => b.slice(0, cursorPos - 1) + b.slice(cursorPos));
        setCursorPos((p) => p - 1);
      }
      return;
    }

    // Ctrl+H — same as backspace
    if (key.ctrl && (input === 'h' || input === '\x08')) {
      if (cursorPos > 0) {
        setInputBuffer((b) => b.slice(0, cursorPos - 1) + b.slice(cursorPos));
        setCursorPos((p) => p - 1);
      }
      return;
    }

    // Ctrl+K — delete to end of line
    if (key.ctrl && (input === 'k' || input === '\x0b')) {
      setInputBuffer((b) => b.slice(0, cursorPos));
      return;
    }

    // Ctrl+U — delete to start of line (respects cursor)
    if (key.ctrl && (input === 'u' || input === '\x15')) {
      setInputBuffer((b) => b.slice(cursorPos));
      setCursorPos(0);
      return;
    }

    // Ctrl+W — delete previous word (respects cursor)
    if (key.ctrl && (input === 'w' || input === '\x17')) {
      const newPos = prevWordStart(inputBuffer, cursorPos);
      setInputBuffer((b) => b.slice(0, newPos) + b.slice(cursorPos));
      setCursorPos(newPos);
      return;
    }

    // Ctrl+F / rightArrow — move cursor right
    if ((key.ctrl && (input === 'f' || input === '\x06')) ||
        (key.rightArrow && !slashSuggestions.length && !followups.length)) {
      setCursorPos((p) => Math.min(p + 1, inputBufferRef.current.length));
      return;
    }

    // Ctrl+B / leftArrow — move cursor left
    if ((key.ctrl && (input === 'b' || input === '\x02')) ||
        (key.leftArrow && !slashSuggestions.length && !followups.length)) {
      setCursorPos((p) => Math.max(p - 1, 0));
      return;
    }

    // Alt+F / Meta+right — forward one word
    if ((key.meta && key.rightArrow) || input === '\x1bf') {
      setCursorPos((p) => nextWordEnd(inputBufferRef.current, p));
      return;
    }

    // Alt+B / Meta+left — back one word
    if ((key.meta && key.leftArrow) || input === '\x1bb') {
      setCursorPos((p) => prevWordStart(inputBufferRef.current, p));
      return;
    }

    // Arrow up/down — navigate slash suggestions, followup chips, or input history
    if (key.upArrow) {
      if (slashSuggestions.length) {
        setSlashIndex((i) => (i - 1 + slashSuggestions.length) % slashSuggestions.length);
      } else if (followups.length) {
        setFollowupIndex((i) => (i - 1 + followups.length) % followups.length);
      } else {
        // Input history navigation
        if (historyIndex === -1) {
          setSavedInput(inputBuffer);
          setHistoryIndex(0);
          const entry = inputHistory[0] ?? '';
          setInputBuffer(entry);
          setCursorPos(entry.length);
        } else {
          const next = Math.min(historyIndex + 1, inputHistory.length - 1);
          setHistoryIndex(next);
          const entry = inputHistory[next] ?? '';
          setInputBuffer(entry);
          setCursorPos(entry.length);
        }
      }
      return;
    }
    if (key.downArrow) {
      if (slashSuggestions.length) {
        setSlashIndex((i) => (i + 1) % slashSuggestions.length);
      } else if (followups.length) {
        setFollowupIndex((i) => (i + 1) % followups.length);
      } else if (historyIndex >= 0) {
        // Input history navigation downward
        const next = historyIndex - 1;
        if (next < 0) {
          setHistoryIndex(-1);
          setInputBuffer(savedInput);
          setCursorPos(savedInput.length);
        } else {
          setHistoryIndex(next);
          const entry = inputHistory[next] ?? '';
          setInputBuffer(entry);
          setCursorPos(entry.length);
        }
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

    // Escape — clear suggestions / exit history mode
    if (key.escape) {
      if (historyIndex >= 0) {
        setHistoryIndex(-1);
        setInputBuffer(savedInput);
        setCursorPos(savedInput.length);
      } else {
        setFollowupsState([]); setFollowupIndex(0);
      }
      return;
    }

    // Regular character — insert at cursor position
    if (input && !key.ctrl && !key.meta) {
      setInputBuffer((b) => b.slice(0, cursorPos) + input + b.slice(cursorPos));
      setCursorPos((p) => p + input.length);
    }
  });

  // ─── Footer bar content ───────────────────────────────────────────────────
  const tokenPart = tokenCount > 0 ? `  ·  ~${Math.round(tokenCount / 1000)}k ctx` : '';
  const branchPart = appState.branch ? `  \uE0A0 ${appState.branch}` : '';
  const modeBadge = ` [${mode}]`;
  const footerRight = `${appState.model}${tokenPart}`;
  const footerLeft = appState.cwd + branchPart;
  const modeColor = mode === 'ask' ? colors.success : mode === 'plan' ? colors.brand : colors.warning;
  const footerGap = Math.max(1, cols - footerLeft.length - modeBadge.length - footerRight.length - 2);

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
            <AppHeader key="header" {...appState} mode={mode} />
          ) : (
            <HistoryItem key={item.id} message={item.msg} terminalWidth={cols} showReasoning={showReasoning} />
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
        {busy ? (
          <Text color={colors.warning}>{'◆ '}</Text>
        ) : (
          <Text bold color={colors.success}>{'❯ '}</Text>
        )}
        <Text>{inputBuffer.slice(0, cursorPos)}</Text>
        {!busy ? (
          <Text inverse>{inputBuffer[cursorPos] ?? ' '}</Text>
        ) : null}
        <Text>{inputBuffer.slice(cursorPos + (busy ? 0 : 1))}</Text>
        {!inputBuffer && !busy && (
          <Text dimColor>Enter @ to mention files or / for commands…</Text>
        )}
        {busy && <Text dimColor>{' (working…)'}</Text>}
      </Box>
      <Box>
        <Text color={colors.separator}>{'▀'.repeat(cols)}</Text>
      </Box>

      {/* ═══ STATUS FOOTER ══════════════════════════════════════════════════ */}
      <Box paddingX={1}>
        <Text color={colors.muted}>{footerLeft}</Text>
        <Text color={modeColor}>{modeBadge}</Text>
        <Text>{' '.repeat(Math.max(0, footerGap))}</Text>
        <Text color={colors.muted}>{footerRight}</Text>
      </Box>

    </Box>
  );
}
