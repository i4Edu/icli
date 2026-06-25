import fs from 'node:fs/promises';
import path from 'node:path';
import { spawn, spawnSync } from 'node:child_process';
import simpleGit, { type SimpleGit } from 'simple-git';
import type { ChatCompletionMessageParam } from 'openai/resources/chat/completions';
import { confirm } from '@inquirer/prompts';
import { config } from '../config.js';
import { Session } from '../session/session.js';
import { streamChat } from '../api/github-models.js';
import { renderMarkdownString } from '../ui/render.js';
import { theme } from '../ui/theme.js';

function git(): SimpleGit {
  return simpleGit({ baseDir: config.cwd });
}

const REVIEW_PROMPT = `You are reviewing staged git changes.
Surface only meaningful bugs, security risks, performance issues, missing tests, and concrete suggestions.
Use Markdown with severity labels. If no issues are found, say so briefly.`;

const ISSUE_PROMPT = `Draft a GitHub issue from repository context.
Output Markdown only:
# <concise title>

## Context
## Problem / Opportunity
## Proposed Work
## Acceptance Criteria
## Notes / Risks`;

export async function reviewStaged(session: Session, signal?: AbortSignal) {
  let staged = '';
  try {
    staged = await git().diff(['--cached']);
  } catch (e: any) {
    process.stdout.write(theme.err(`git failed: ${e?.message}\n`));
    return;
  }
  if (!staged.trim()) {
    process.stdout.write(theme.warn('No staged changes. Stage files with `git add` first.\n'));
    return;
  }

  const messages: ChatCompletionMessageParam[] = [
    { role: 'system', content: REVIEW_PROMPT },
    {
      role: 'user',
      content:
        `Model: ${session.state.model}\nReview this staged diff:\n\n` + staged.slice(0, 80_000),
    },
  ];

  process.stdout.write(theme.dim('Reviewing staged changes…\n\n'));
  await streamChat({
    model: session.state.model,
    messages,
    temperature: 0.2,
    signal,
    onToken: (t) => process.stdout.write(t),
  });
  process.stdout.write('\n');
}

export async function draftIssue(session: Session, signal?: AbortSignal, title?: string) {
  const g = git();
  try {
    const branch = (await g.raw(['rev-parse', '--abbrev-ref', 'HEAD'])).trim();
    const base = await defaultBranch(g);
    const log = await g.raw(['log', `${base}..HEAD`, '--pretty=format:%h %s']).catch(() => '');
    const diff = await g.raw(['diff', `${base}...HEAD`]).catch(() => '');
    const status = await g.status();

    const messages: ChatCompletionMessageParam[] = [
      { role: 'system', content: ISSUE_PROMPT },
      {
        role: 'user',
        content:
          `Model: ${session.state.model}\n` +
          `Requested title: ${title || '(infer one)'}\n` +
          `Branch: ${branch}\nDefault branch: ${base}\n` +
          `Status: ${JSON.stringify(status, null, 2)}\n\n` +
          `Recent commits:\n${log || '(none)'}\n\n` +
          `Diff vs ${base}:\n${diff.slice(0, 80_000) || '(none)'}`,
      },
    ];

    process.stdout.write(theme.dim('Drafting issue…\n'));
    let md = '';
    await streamChat({
      model: session.state.model,
      messages,
      temperature: 0.3,
      signal,
      onToken: (t) => {
        md += t;
      },
    });
    const issueTitle = title || extractTitle(md);
    const body = stripTitle(md).trim() || md.trim();
    process.stdout.write('\n' + renderMarkdownString(md) + '\n');

    await offerClipboard(md);
    await offerGhIssue(issueTitle, body);
  } catch (e: any) {
    process.stdout.write(theme.err(`/issue failed: ${e?.message}\n`));
  }
}

export async function scaffoldBranch(
  _session: Session,
  _signal: AbortSignal | undefined,
  topic: string,
) {
  if (!topic.trim()) {
    process.stdout.write(theme.warn('Usage: /branch <topic>\n'));
    return;
  }
  const name = branchName(topic);
  process.stdout.write(theme.dim(`Suggested branch: ${name}\n`));
  if (!commandExists('git')) {
    process.stdout.write(theme.warn('git is not available on PATH.\n'));
    return;
  }
  const ok = await confirm({ message: `Create and checkout ${name}?`, default: true }).catch(
    () => false,
  );
  if (!ok) return;
  try {
    await git().raw(['checkout', '-b', name]);
    process.stdout.write(theme.ok(`✔ checked out ${name}\n`));
  } catch (e: any) {
    process.stdout.write(theme.err(`branch failed: ${e?.message}\n`));
  }
}

async function defaultBranch(g: SimpleGit): Promise<string> {
  try {
    const remote = await g.raw(['symbolic-ref', 'refs/remotes/origin/HEAD']);
    const match = remote.match(/refs\/remotes\/origin\/(.+)/);
    if (match) return match[1].trim();
  } catch {
    /* fall through */
  }
  for (const candidate of ['main', 'master', 'develop']) {
    try {
      await g.raw(['rev-parse', '--verify', candidate]);
      return candidate;
    } catch {
      /* keep trying */
    }
  }
  return 'main';
}

function extractTitle(md: string): string {
  const heading = md.match(/^#\s+(.+)$/m);
  return (heading?.[1] || 'Issue drafted by iCopilot').trim();
}

function stripTitle(md: string): string {
  return md.replace(/^#\s+.+\r?\n+/, '');
}

async function offerClipboard(text: string): Promise<void> {
  const ok = await confirm({ message: 'Copy issue draft to clipboard?', default: false }).catch(
    () => false,
  );
  if (!ok) return;
  const command =
    process.platform === 'win32' ? 'clip' : process.platform === 'darwin' ? 'pbcopy' : 'xclip';
  const args = process.platform === 'linux' ? ['-selection', 'clipboard'] : [];
  const child = spawn(command, args, { stdio: ['pipe', 'ignore', 'ignore'], windowsHide: true });
  child.stdin.end(text);
}

async function offerGhIssue(title: string, body: string): Promise<void> {
  if (!commandExists('gh')) return;
  const ok = await confirm({ message: 'Create issue with gh CLI?', default: false }).catch(
    () => false,
  );
  if (!ok) return;

  const file = path.join(config.cwd, `.icopilot-issue-${Date.now()}.md`);
  try {
    await fs.writeFile(file, body + '\n', 'utf8');
    await run('gh', ['issue', 'create', '--title', title, '--body-file', file], config.cwd);
  } finally {
    await fs.rm(file, { force: true }).catch(() => undefined);
  }
}

function branchName(topic: string): string {
  const cleaned = topic
    .trim()
    .toLowerCase()
    .replace(/['"]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 48)
    .replace(/-+$/g, '');
  const prefix = /^(fix|bug|hotfix)\b/.test(topic.toLowerCase()) ? 'fix' : 'feat';
  return `${prefix}/${cleaned || 'work'}`;
}

function commandExists(command: string): boolean {
  const checker = process.platform === 'win32' ? 'where.exe' : 'which';
  return spawnSync(checker, [command], { stdio: 'ignore' }).status === 0;
}

function run(command: string, args: string[], cwd: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { cwd, stdio: 'inherit', windowsHide: true });
    child.on('error', reject);
    child.on('exit', (code) => {
      if (code === 0) resolve();
      else reject(new Error(`${command} exited with code ${code}`));
    });
  });
}
