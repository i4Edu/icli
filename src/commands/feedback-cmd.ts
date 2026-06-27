import { execFileSync, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { theme } from '../ui/theme.js';

export type FeedbackType = 'bug' | 'feature' | 'praise';

export interface FeedbackEntry {
  type: FeedbackType;
  text: string;
  timestamp: string;
  cwd?: string;
  repo?: string;
}

export function feedbackPath(): string {
  const configured =
    process.env.ICOPILOT_FEEDBACK_PATH || path.join(os.homedir(), '.icopilot', 'feedback.json');
  if (configured === '~') return os.homedir();
  if (/^~[\\/]/.test(configured)) return path.join(os.homedir(), configured.slice(2));
  return path.resolve(configured);
}

export function submitFeedback(
  type: FeedbackType,
  text: string,
  options: { cwd?: string; repo?: string } = {},
): string {
  const trimmed = text.trim();
  if (!trimmed) {
    throw new Error('feedback text is required');
  }

  const entries = loadFeedback();
  const repo = options.repo ?? getGitHubRepoSlug(options.cwd);
  entries.push({
    type,
    text: trimmed,
    timestamp: new Date().toISOString(),
    cwd: options.cwd,
    repo: repo ?? undefined,
  });
  saveFeedback(entries);

  const lines = [theme.ok('Thank you for your feedback!')];
  if (repo) {
    lines.push(theme.dim(`GitHub issues: ${buildGitHubIssuesUrl(repo)}`));
  }
  return `${lines.join('\n')}\n`;
}

export function loadFeedback(): FeedbackEntry[] {
  const file = feedbackPath();
  if (!fs.existsSync(file)) return [];
  try {
    const parsed = JSON.parse(fs.readFileSync(file, 'utf8')) as unknown;
    if (!Array.isArray(parsed)) return [];
    return parsed.flatMap((entry) => {
      if (!entry || typeof entry !== 'object') return [];
      const record = entry as Record<string, unknown>;
      if (
        (record.type !== 'bug' && record.type !== 'feature' && record.type !== 'praise') ||
        typeof record.text !== 'string' ||
        typeof record.timestamp !== 'string'
      ) {
        return [];
      }
      return [
        {
          type: record.type,
          text: record.text,
          timestamp: record.timestamp,
          cwd: typeof record.cwd === 'string' ? record.cwd : undefined,
          repo: typeof record.repo === 'string' ? record.repo : undefined,
        } satisfies FeedbackEntry,
      ];
    });
  } catch {
    return [];
  }
}

export function saveFeedback(entries: FeedbackEntry[]): void {
  const file = feedbackPath();
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, `${JSON.stringify(entries, null, 2)}\n`, 'utf8');
}

export function buildGitHubIssuesUrl(repo: string): string {
  return `https://github.com/${repo}/issues/new`;
}

export function getGitHubRepoSlug(cwd = process.cwd()): string | null {
  try {
    const remote = execFileSync('git', ['remote', 'get-url', 'origin'], {
      cwd,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
      windowsHide: true,
    }).trim();
    const match = remote.match(/github\.com[:/]([^/\s]+\/[^/\s]+?)(?:\.git)?$/i);
    return match?.[1] ?? null;
  } catch {
    return null;
  }
}

export function openGitHubIssues(repo: string): boolean {
  const url = buildGitHubIssuesUrl(repo);
  const result =
    process.platform === 'win32'
      ? spawnSync('cmd', ['/c', 'start', '', url], { windowsHide: true })
      : process.platform === 'darwin'
        ? spawnSync('open', [url], { windowsHide: true })
        : spawnSync('xdg-open', [url], { windowsHide: true });
  return result.status === 0;
}
