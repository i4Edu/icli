import simpleGit from 'simple-git';

export interface CommitInfo {
  hash: string;
  subject: string;
  author: string;
  date: string;
}

export interface ChangelogPayload {
  commits: CommitInfo[];
  fromRef: string;
  toRef: string;
  prompt: string;
}

interface GitLogEntry {
  hash: string;
  date: string;
  message: string;
  author_name: string;
}

export async function buildChangelogPrompt(args: string[], cwd: string): Promise<ChangelogPayload> {
  const git = simpleGit({ baseDir: cwd });

  try {
    const isRepo = await git.checkIsRepo();
    if (!isRepo) {
      return buildEmptyPayload(
        `Cannot generate a changelog because "${cwd}" is not a git repository.`,
      );
    }

    const parsed = parseArgs(args);

    if (parsed.kind === 'range') {
      const commits = mapCommits((await git.log([`${parsed.fromRef}..${parsed.toRef}`])).all);
      return buildPayload(commits, parsed.fromRef, parsed.toRef);
    }

    if (parsed.kind === 'last') {
      const commits = mapCommits((await git.log({ maxCount: parsed.count })).all);
      return buildPayload(commits, commits.at(-1)?.hash ?? 'HEAD', 'HEAD');
    }

    const tags = await git.tags();
    if (tags.latest) {
      const commits = mapCommits((await git.log([`${tags.latest}..HEAD`])).all);
      return buildPayload(commits, tags.latest, 'HEAD');
    }

    const commits = mapCommits((await git.log({ maxCount: 20 })).all);
    return buildPayload(commits, commits.at(-1)?.hash ?? 'HEAD', 'HEAD');
  } catch (error) {
    if (isNotGitRepositoryError(error)) {
      return buildEmptyPayload(
        `Cannot generate a changelog because "${cwd}" is not a git repository.`,
      );
    }
    throw error;
  }
}

function parseArgs(
  args: string[],
):
  | { kind: 'default' }
  | { kind: 'range'; fromRef: string; toRef: string }
  | { kind: 'last'; count: number } {
  if (args.length === 0) {
    return { kind: 'default' };
  }

  if (args[0] === '--last') {
    const count = Number.parseInt(args[1] ?? '', 10);
    if (!Number.isInteger(count) || count <= 0) {
      throw new Error('Usage: /changelog [<from>..<to> | --last <n>]');
    }
    return { kind: 'last', count };
  }

  if (args.length === 1 && args[0].includes('..')) {
    const [fromRef, toRef] = args[0].split('..');
    if (!fromRef || !toRef) {
      throw new Error('Usage: /changelog [<from>..<to> | --last <n>]');
    }
    return { kind: 'range', fromRef, toRef };
  }

  throw new Error('Usage: /changelog [<from>..<to> | --last <n>]');
}

function mapCommits(entries: ReadonlyArray<GitLogEntry>): CommitInfo[] {
  return entries.map((entry) => ({
    hash: entry.hash,
    subject: entry.message,
    author: entry.author_name,
    date: entry.date,
  }));
}

function buildPayload(commits: CommitInfo[], fromRef: string, toRef: string): ChangelogPayload {
  return {
    commits,
    fromRef,
    toRef,
    prompt: buildPrompt(commits, fromRef, toRef),
  };
}

function buildEmptyPayload(message: string): ChangelogPayload {
  return {
    commits: [],
    fromRef: '',
    toRef: '',
    prompt: message,
  };
}

function buildPrompt(commits: CommitInfo[], fromRef: string, toRef: string): string {
  const commitLines =
    commits.length === 0
      ? ['- No commits found in the selected range.']
      : commits.map(
          (commit) => `- ${commit.subject} (${commit.hash}) — ${commit.author} on ${commit.date}`,
        );

  return [
    `Generate a markdown changelog entry for git commits from ${fromRef} to ${toRef}.`,
    'Instructions:',
    '- Group commits by type using these sections when applicable: Features, Fixes, Chores, Documentation.',
    '- Infer the type from conventional commit prefixes such as feat, fix, chore, and docs.',
    '- Include a dedicated Breaking Changes section when any commit indicates a breaking change.',
    '- Keep the writing concise, user-facing, and release-note friendly.',
    '- Output markdown only.',
    '',
    'Commits:',
    ...commitLines,
  ].join('\n');
}

function isNotGitRepositoryError(error: unknown): boolean {
  if (!(error instanceof Error)) {
    return false;
  }

  return /not a git repository/i.test(error.message);
}
