import simpleGit, { type SimpleGit } from 'simple-git';
import { config } from '../config.js';
import { type ChangeTrackingState, type GitTurnSnapshot, Session } from '../session/session.js';
import { theme } from '../ui/theme.js';

const EMPTY_TREE_SHA = '4b825dc642cb6eb9a060e54bf8d69288fbee4904';

let activeSession: Session | null = null;

export async function ensureChangeTracking(session?: Session): Promise<ChangeTrackingState> {
  const resolved = resolveSession(session);
  activeSession = resolved;

  if (resolved.state.changeTracking) {
    return resolved.state.changeTracking;
  }

  const sessionStartRef = await createSnapshotRef(resolved.state.cwd);
  const tracking: ChangeTrackingState = {
    sessionStartRef,
    sessionStartAt: new Date().toISOString(),
    turnSnapshots: [],
  };
  resolved.state.changeTracking = tracking;
  resolved.persist();
  return tracking;
}

export async function recordTurnSnapshot(session?: Session): Promise<GitTurnSnapshot | null> {
  const resolved = resolveSession(session);
  const tracking = await ensureChangeTracking(resolved);
  const turnIndex = countAssistantMessages(resolved);
  const ref = await createSnapshotRef(resolved.state.cwd);
  const snapshot: GitTurnSnapshot = {
    turnIndex,
    ref,
    createdAt: new Date().toISOString(),
  };

  if (tracking.turnSnapshots.at(-1)?.turnIndex === turnIndex) {
    tracking.turnSnapshots[tracking.turnSnapshots.length - 1] = snapshot;
  } else {
    tracking.turnSnapshots.push(snapshot);
  }
  resolved.state.changeTracking = tracking;
  resolved.persist();
  return snapshot;
}

export async function showChangesSinceSessionStart(): Promise<string>;
export async function showChangesSinceSessionStart(session: Session): Promise<string>;
export async function showChangesSinceSessionStart(session?: Session): Promise<string> {
  const resolved = resolveSession(session);
  const tracking = await ensureChangeTracking(resolved);
  return formatDiff(
    await diffSinceRef(resolved.state.cwd, tracking.sessionStartRef),
    'session start',
    'No uncommitted changes since session start.',
  );
}

export async function showChangesSinceLastTurn(): Promise<string>;
export async function showChangesSinceLastTurn(session: Session): Promise<string>;
export async function showChangesSinceLastTurn(session?: Session): Promise<string> {
  const resolved = resolveSession(session);
  const tracking = await ensureChangeTracking(resolved);
  const snapshot = tracking.turnSnapshots.at(-1);
  if (!snapshot) {
    return theme.warn('No AI turns have been recorded yet.\n');
  }

  return formatDiff(
    await diffSinceRef(resolved.state.cwd, snapshot.ref),
    `AI turn ${snapshot.turnIndex + 1}`,
    'No uncommitted changes since the last AI turn.',
  );
}

export async function showChangesSinceMessage(turnIndex: number): Promise<string>;
export async function showChangesSinceMessage(turnIndex: number, session: Session): Promise<string>;
export async function showChangesSinceMessage(turnIndex: number, session?: Session): Promise<string> {
  const resolved = resolveSession(session);
  const tracking = await ensureChangeTracking(resolved);
  const snapshot = tracking.turnSnapshots.find((entry) => entry.turnIndex === turnIndex);
  if (!snapshot) {
    return theme.warn(`No snapshot recorded for AI turn ${turnIndex + 1}.\n`);
  }

  return formatDiff(
    await diffSinceRef(resolved.state.cwd, snapshot.ref),
    `AI turn ${turnIndex + 1}`,
    `No uncommitted changes since AI turn ${turnIndex + 1}.`,
  );
}

function resolveSession(session?: Session): Session {
  const resolved = session ?? activeSession;
  if (!resolved) {
    throw new Error('No active session is available for /changes.');
  }
  return resolved;
}

async function createSnapshotRef(cwd: string): Promise<string> {
  const git = createGit(cwd);
  const isRepo = await git.checkIsRepo();
  if (!isRepo) {
    throw new Error(`Not a git repository: ${cwd}`);
  }

  const snapshot = (await git.raw(['stash', 'create', 'icli-turn-snapshot'])).trim();
  if (snapshot) return snapshot;

  try {
    return (await git.raw(['rev-parse', '--verify', 'HEAD'])).trim();
  } catch {
    return EMPTY_TREE_SHA;
  }
}

async function diffSinceRef(cwd: string, ref: string): Promise<string> {
  const git = createGit(cwd);
  const isRepo = await git.checkIsRepo();
  if (!isRepo) {
    throw new Error(`Not a git repository: ${cwd}`);
  }
  return git.diff([ref]);
}

function createGit(cwd: string): SimpleGit {
  return simpleGit({ baseDir: cwd });
}

function countAssistantMessages(session: Session): number {
  return session.state.messages.filter((message) => message.role === 'assistant').length;
}

function formatDiff(diff: string, label: string, emptyMessage: string): string {
  if (!diff.trim()) {
    return theme.dim(`${emptyMessage}\n`);
  }

  return `${theme.hl(`Changes since ${label}:`)}\n${colorize(diff)}\n`;
}

function colorize(diff: string): string {
  return diff
    .split('\n')
    .map((line) =>
      line.startsWith('+') && !line.startsWith('+++')
        ? theme.ok(line)
        : line.startsWith('-') && !line.startsWith('---')
          ? theme.err(line)
          : line.startsWith('@@')
            ? theme.hl(line)
            : line.startsWith('diff ') || line.startsWith('index ')
              ? theme.dim(line)
              : line,
    )
    .join('\n');
}
