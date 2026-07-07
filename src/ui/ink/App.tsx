import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Box, Static, Text, useApp, useInput, useStdout } from 'ink';
import { AppHeader } from './AppHeader.js';
import { Composer } from './Composer.js';
import { HistoryItem, type HistoryMessage } from './HistoryItem.js';
import { colors } from './theme.js';

// ── The App receives callbacks from the TUI runner ───────────────────────────

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

export interface TuiHandle {
  appendMessage: (msg: HistoryMessage) => void;
  updateLastMessage: (content: string) => void;
  setBusy: (busy: boolean) => void;
  setTokenCount: (n: number) => void;
  setFollowups: (chips: string[]) => void;
  pushNotification: (text: string, color?: string) => void;
}

interface AppProps {
  appState: AppState;
  callbacks: AppCallbacks;
  registerHandle: (handle: TuiHandle) => void;
}

// Inline spinner frames
const FRAMES = ['⠋', '⠙', '⠹', '⠸', '⠼', '⠴', '⠦', '⠧', '⠇', '⠏'];

export function App({ appState, callbacks, registerHandle }: AppProps): React.ReactElement {
  const { exit } = useApp();
  const { stdout } = useStdout();

  // ── State ───────────────────────────────────────────────────────────────
  const [history, setHistory] = useState<HistoryMessage[]>([]);
  const [inputBuffer, setInputBuffer] = useState('');
  const [busy, setBusyState] = useState(false);
  const [tokenCount, setTokenCountState] = useState(0);
  const [followups, setFollowupsState] = useState<string[]>([]);
  const [followupIndex, setFollowupIndex] = useState(0);
  const [spinnerFrame, setSpinnerFrame] = useState(0);
  const [notification, setNotification] = useState<{ text: string; color?: string } | null>(null);
  const [thinkingMsgId, setThinkingMsgId] = useState<string | null>(null);

  const busyRef = useRef(false);
  const historyRef = useRef<HistoryMessage[]>([]);

  // Sync busy ref for use inside closures
  useEffect(() => {
    busyRef.current = busy;
  }, [busy]);

  // Spinner tick
  useEffect(() => {
    if (!busy) return;
    const t = setInterval(() => setSpinnerFrame((f) => f + 1), 80);
    return () => clearInterval(t);
  }, [busy]);

  // Auto-clear notifications
  useEffect(() => {
    if (!notification) return;
    const t = setTimeout(() => setNotification(null), 4000);
    return () => clearTimeout(t);
  }, [notification]);

  // ── Handle registration ─────────────────────────────────────────────────
  useEffect(() => {
    const handle: TuiHandle = {
      appendMessage(msg) {
        historyRef.current = [...historyRef.current, msg];
        setHistory([...historyRef.current]);
      },
      updateLastMessage(content) {
        const msgs = [...historyRef.current];
        if (!msgs.length) return;
        msgs[msgs.length - 1] = { ...msgs[msgs.length - 1]!, content };
        historyRef.current = msgs;
        setHistory(msgs);
      },
      setBusy(b) {
        busyRef.current = b;
        setBusyState(b);
        if (b) {
          // Insert a "thinking" placeholder
          const id = `thinking-${Date.now()}`;
          const msg: HistoryMessage = { id, role: 'copilot', content: '' };
          historyRef.current = [...historyRef.current, msg];
          setHistory([...historyRef.current]);
          setThinkingMsgId(id);
        } else {
          setThinkingMsgId(null);
        }
      },
      setTokenCount: setTokenCountState,
      setFollowups(chips) {
        setFollowupsState(chips);
        setFollowupIndex(0);
      },
      pushNotification(text, color) {
        setNotification({ text, color });
      },
    };
    registerHandle(handle);
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // ── Keyboard input ──────────────────────────────────────────────────────
  useInput((input, key) => {
    if (key.ctrl && (input === 'c' || input === '\x03')) {
      if (busyRef.current) {
        callbacks.onCancel();
        return;
      }
      callbacks.onExit();
      exit();
      return;
    }

    if (busy) return; // block other input while working

    if (key.return) {
      const line = inputBuffer.trim();
      if (!line && followups.length) {
        const idx = ((followupIndex % followups.length) + followups.length) % followups.length;
        const choice = followups[idx] ?? '';
        setFollowupsState([]);
        setFollowupIndex(0);
        setInputBuffer('');
        void callbacks.onLine(choice);
        return;
      }
      if (!line) return;
      setInputBuffer('');
      setFollowupsState([]);
      setFollowupIndex(0);
      void callbacks.onLine(line);
      return;
    }

    if (key.backspace || key.delete) {
      setInputBuffer((b) => b.slice(0, -1));
      return;
    }

    if (key.ctrl && (input === 'u' || input === '\x15')) {
      setInputBuffer('');
      return;
    }

    if (key.ctrl && (input === 'w' || input === '\x17')) {
      setInputBuffer((b) => b.replace(/\S+\s*$/, ''));
      return;
    }

    if (key.ctrl && (input === 'n' || input === '\x0e') && followups.length) {
      setFollowupIndex((i) => (i + 1) % followups.length);
      return;
    }

    if (key.ctrl && (input === 'p' || input === '\x10') && followups.length) {
      setFollowupIndex((i) => (i - 1 + followups.length) % followups.length);
      return;
    }

    if (key.escape) {
      setFollowupsState([]);
      setFollowupIndex(0);
      return;
    }

    if (input && !key.ctrl && !key.meta) {
      setInputBuffer((b) => b + input);
    }
  });

  // ── Spinner content for the "thinking" placeholder ──────────────────────
  const spinnerIcon = FRAMES[spinnerFrame % FRAMES.length] ?? '⠋';
  const terminalWidth = stdout.columns || 80;

  // ── Render ──────────────────────────────────────────────────────────────
  return (
    <Box flexDirection="column" width="100%">
      {/* Static: header + frozen history items (won't re-render) */}
      <Static items={[{ id: '__header__', type: 'header' as const }, ...history.map((m) => ({ id: m.id, type: 'msg' as const, msg: m }))]}>
        {(item) => {
          if (item.type === 'header') {
            return (
              <AppHeader
                key="header"
                model={appState.model}
                provider={appState.provider}
                branch={appState.branch}
                cwd={appState.cwd}
                version={appState.version}
              />
            );
          }
          // While busy, the last item (thinking placeholder) is rendered live below
          if (item.id === thinkingMsgId) return <Box key={item.id} />;
          return (
            <HistoryItem
              key={item.id}
              message={item.msg}
              terminalWidth={terminalWidth}
            />
          );
        }}
      </Static>

      {/* Live: thinking indicator (updates every frame) */}
      {busy && thinkingMsgId && (
        <Box flexDirection="column" width="100%">
          <Box>
            <Text color={colors.separator}>{'─'.repeat(Math.max(0, terminalWidth))}</Text>
          </Box>
          <Box paddingX={1}>
            <Text bold color={colors.copilot}>{'● '}</Text>
            <Text bold>{'Copilot'}</Text>
          </Box>
          <Box paddingX={1} paddingBottom={1}>
            <Text color={colors.muted}>{spinnerIcon} </Text>
            <Text dimColor>Thinking…</Text>
          </Box>
        </Box>
      )}

      {/* Notification banner */}
      {notification && (
        <Box paddingX={1} borderStyle="round" borderColor={notification.color ?? colors.warning}>
          <Text color={notification.color ?? colors.warning}>{notification.text}</Text>
        </Box>
      )}

      {/* Composer: always at the bottom */}
      <Composer
        value={inputBuffer}
        busy={busy}
        model={appState.model}
        branch={appState.branch}
        tokenCount={tokenCount}
        followups={followups}
        followupIndex={followupIndex}
        onSubmit={(line) => {
          setInputBuffer('');
          void callbacks.onLine(line);
        }}
        onFollowupCycle={(dir) =>
          setFollowupIndex((i) => (i + dir + followups.length) % followups.length)
        }
        onFollowupClear={() => {
          setFollowupsState([]);
          setFollowupIndex(0);
        }}
      />
    </Box>
  );
}
