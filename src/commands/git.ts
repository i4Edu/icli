import simpleGit, { type SimpleGit } from 'simple-git';
import type { ChatCompletionMessageParam } from 'openai/resources/chat/completions';
import { confirm } from '@inquirer/prompts';
import { config } from '../config.js';
import { Session } from '../session/session.js';
import { streamChat } from '../api/github-models.js';
import { theme } from '../ui/theme.js';
import { renderMarkdownString } from '../ui/render.js';

function git(): SimpleGit {
  return simpleGit({ baseDir: config.cwd });
}

export async function showDiff() {
  try {
    const d = await git().diff();
    if (!d.trim()) {
      process.stdout.write(theme.dim('No unstaged changes.\n'));
      const staged = await git().diff(['--cached']);
      if (staged.trim()) {
        process.stdout.write(theme.hl('Staged changes:\n') + colorize(staged) + '\n');
      }
      return;
    }
    process.stdout.write(colorize(d) + '\n');
  } catch (e: any) {
    process.stdout.write(theme.err(`git diff failed: ${e?.message}\n`));
  }
}

const COMMIT_PROMPT = `You write semantic commit messages following Conventional Commits.
Output ONLY the commit message — no fences, no commentary.
Format:
<type>(<optional scope>): <short summary in imperative mood, ≤72 chars>

<optional body explaining what and why; wrap at 72 cols>`;

export async function commitFromStaged(session: Session, signal?: AbortSignal) {
  let staged: string;
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
    { role: 'system', content: COMMIT_PROMPT },
    { role: 'user', content: 'Generate a commit message for this diff:\n\n' + staged },
  ];

  process.stdout.write(theme.dim('Generating commit message…\n'));
  let msg = '';
  await streamChat({
    model: session.state.model,
    messages,
    temperature: 0.2,
    signal,
    onToken: (t) => {
      msg += t;
      process.stdout.write(t);
    },
  });
  msg = msg
    .trim()
    .replace(/^```[\w]*\n?|```$/g, '')
    .trim();
  process.stdout.write('\n');

  const ok = await confirm({ message: 'Commit with this message?', default: false }).catch(
    () => false,
  );
  if (!ok) return;
  try {
    const res = await git().commit(msg);
    process.stdout.write(theme.ok(`✔ committed ${res.commit}\n`));
  } catch (e: any) {
    process.stdout.write(theme.err(`commit failed: ${e?.message}\n`));
  }
}

const PR_PROMPT = `You write high-quality pull request descriptions in Markdown.
Sections: ## Summary, ## Changes (bulleted), ## Why, ## Test plan, ## Risks.
Be concise. Output Markdown only.`;

export async function prDescription(session: Session, signal?: AbortSignal) {
  const g = git();
  try {
    // Determine default branch
    let base = 'main';
    try {
      const remote = await g.raw(['symbolic-ref', 'refs/remotes/origin/HEAD']);
      const m = remote.match(/refs\/remotes\/origin\/(.+)/);
      if (m) base = m[1].trim();
    } catch {
      // try common fallbacks
      for (const b of ['main', 'master', 'develop']) {
        try {
          await g.raw(['rev-parse', '--verify', b]);
          base = b;
          break;
        } catch {
          /* keep trying */
        }
      }
    }
    const branch = (await g.raw(['rev-parse', '--abbrev-ref', 'HEAD'])).trim();
    if (branch === base) {
      process.stdout.write(
        theme.warn(`On default branch (${base}); switch to a feature branch.\n`),
      );
      return;
    }
    const diff = await g.raw(['diff', `${base}...HEAD`]);
    const log = await g.raw(['log', `${base}..HEAD`, '--pretty=format:%h %s']);
    if (!diff.trim()) {
      process.stdout.write(theme.warn(`No changes vs ${base}.\n`));
      return;
    }
    const messages: ChatCompletionMessageParam[] = [
      { role: 'system', content: PR_PROMPT },
      {
        role: 'user',
        content: `Branch: ${branch} → ${base}\n\nCommits:\n${log}\n\nDiff:\n${diff.slice(0, 60_000)}`,
      },
    ];
    process.stdout.write(theme.dim(`Drafting PR description (${branch} → ${base})…\n`));
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
    process.stdout.write('\n' + (await renderMarkdownString(md)) + '\n');
  } catch (e: any) {
    process.stdout.write(theme.err(`/pr failed: ${e?.message}\n`));
  }
}

function colorize(diff: string): string {
  return diff
    .split('\n')
    .map((l) =>
      l.startsWith('+') && !l.startsWith('+++')
        ? theme.ok(l)
        : l.startsWith('-') && !l.startsWith('---')
          ? theme.err(l)
          : l.startsWith('@@')
            ? theme.hl(l)
            : l.startsWith('diff ') || l.startsWith('index ')
              ? theme.dim(l)
              : l,
    )
    .join('\n');
}
