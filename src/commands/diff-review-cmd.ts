import fs from 'node:fs';
import path from 'node:path';
import simpleGit from 'simple-git';
import type { ChatCompletionMessageParam } from 'openai/resources/chat/completions';
import { streamChat } from '../api/github-models.js';
import { Session } from '../session/session.js';
import { theme } from '../ui/theme.js';

export interface DiffReviewPayload {
  diff: string;
  scope: string;
  prompt: string;
}

interface DiffSelection {
  diffArgs: string[];
  scope: string;
}

const DIFF_REVIEW_SYSTEM = `You are reviewing a git diff.
Focus on bugs, security issues, style problems, and concrete improvements.
Prefer specific, actionable feedback tied to files or hunks.
If the diff looks good, say so briefly.`;

export async function buildDiffReviewPrompt(
  args: string[],
  cwd: string,
): Promise<DiffReviewPayload> {
  const git = simpleGit({ baseDir: cwd });
  const isRepo = await git.checkIsRepo();
  if (!isRepo) {
    throw new Error(`Not a git repository: ${cwd}`);
  }

  const selection = selectDiff(args, cwd);
  const diff = await git.diff(selection.diffArgs);
  const prompt = [
    `Review this git diff (${selection.scope}).`,
    'Check for:',
    '- bugs and logic errors',
    '- security issues',
    '- style or readability problems',
    '- missing edge cases or tests',
    '- concrete improvement suggestions',
    '',
    'Diff:',
    diff || '(no diff)',
  ].join('\n');

  return { diff, scope: selection.scope, prompt };
}

export async function reviewDiff(
  session: Session,
  args: string[],
  signal?: AbortSignal,
): Promise<void> {
  try {
    const payload = await buildDiffReviewPrompt(args, session.state.cwd);
    if (!payload.diff.trim()) {
      process.stdout.write(theme.warn(`No changes found for ${payload.scope}.\n`));
      return;
    }

    const messages: ChatCompletionMessageParam[] = [
      { role: 'system', content: DIFF_REVIEW_SYSTEM },
      { role: 'user', content: payload.prompt },
    ];

    process.stdout.write(theme.dim(`Reviewing ${payload.scope}…\n\n`));
    await streamChat({
      model: session.state.model,
      messages,
      temperature: 0.2,
      signal,
      onToken: (token) => process.stdout.write(token),
    });
    process.stdout.write('\n');
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error);
    process.stdout.write(theme.err(`diff review failed: ${message}\n`));
  }
}

function selectDiff(args: string[], cwd: string): DiffSelection {
  if (!args.length) {
    return { diffArgs: [], scope: 'unstaged changes' };
  }

  const target = args.join(' ').trim();
  if (target === '--staged') {
    return { diffArgs: ['--cached'], scope: 'staged changes' };
  }

  if (isExistingFileTarget(target, cwd)) {
    return {
      diffArgs: ['--', target],
      scope: `changes for ${path.relative(cwd, path.resolve(cwd, target)) || target}`,
    };
  }

  if (/^[^\s]+\.\.[^\s]+$/.test(target)) {
    return { diffArgs: [target], scope: `changes between ${target}` };
  }

  if (looksLikePathTarget(target)) {
    return {
      diffArgs: ['--', target],
      scope: `changes for ${path.relative(cwd, path.resolve(cwd, target)) || target}`,
    };
  }

  return { diffArgs: [`${target}...HEAD`], scope: `changes from ${target} to HEAD` };
}

function isExistingFileTarget(target: string, cwd: string): boolean {
  const resolved = path.resolve(cwd, target);
  return fs.existsSync(resolved) && fs.statSync(resolved).isFile();
}

function looksLikePathTarget(target: string): boolean {
  return (
    target.includes('/') ||
    target.includes('\\') ||
    target.startsWith('.') ||
    path.extname(target).length > 0
  );
}
