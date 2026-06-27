import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import simpleGit from 'simple-git';
import { config } from '../config.js';
import { theme } from '../ui/theme.js';

export type ReleaseType = 'major' | 'minor' | 'patch' | 'premajor' | 'preminor' | 'prepatch';

export interface ReleaseOptions {
  type: ReleaseType;
  tag?: string;
  dryRun?: boolean;
  skipChangelog?: boolean;
  skipTag?: boolean;
  skipPublish?: boolean;
}

export interface ReleaseResult {
  version: string;
  changelog: string;
  tag: string;
  published: boolean;
}

interface PackageJsonShape {
  version?: unknown;
  [key: string]: unknown;
}

interface GitCommitEntry {
  hash: string;
  date: string;
  message: string;
  author_name: string;
  body?: string;
}

interface ConventionalCommit {
  hash: string;
  shortHash: string;
  raw: string;
  description: string;
  type: string;
  scope?: string;
  author: string;
  date: string;
  breaking: boolean;
}

interface ReleaseSnapshot {
  cwd: string;
  packagePath: string;
  changelogPath: string;
  packageJson: PackageJsonShape;
  currentVersion: string;
  latestTag: string | null;
  commits: ConventionalCommit[];
  unreleasedChanges: string;
  dirty: boolean;
}

const RELEASE_TYPES: ReleaseType[] = [
  'major',
  'minor',
  'patch',
  'premajor',
  'preminor',
  'prepatch',
];

const DEFAULT_CHANGELOG = `# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

`;

const SECTION_ORDER = [
  'Breaking Changes',
  'Features',
  'Fixes',
  'Documentation',
  'Performance',
  'Refactors',
  'Tests',
  'Build',
  'CI',
  'Chores',
  'Reverts',
  'Other',
] as const;

export async function performRelease(opts: ReleaseOptions): Promise<ReleaseResult> {
  return performReleaseAt(opts, config.cwd);
}

export async function releaseCommand(args: string[], cwd: string): Promise<string> {
  let parsed: ReturnType<typeof parseReleaseArgs>;
  try {
    parsed = parseReleaseArgs(args);
  } catch (error) {
    return `${theme.warn((error as Error).message)}\n`;
  }

  if (parsed.mode === 'status') {
    const snapshot = await getReleaseSnapshot(cwd);
    return formatStatus(snapshot);
  }

  const options: ReleaseOptions =
    parsed.mode === 'preview'
      ? {
          ...parsed.options,
          dryRun: true,
          skipPublish: true,
        }
      : parsed.options;

  try {
    const result = await performReleaseAt(options, cwd);
    return parsed.mode === 'preview' ? formatPreview(result) : formatReleaseResult(result);
  } catch (error) {
    return `${theme.err(`release failed: ${(error as Error).message}`)}\n`;
  }
}

export function calculateNextVersion(currentVersion: string, type: ReleaseType): string {
  const version = parseSemver(currentVersion);

  switch (type) {
    case 'major':
      return formatSemver({ major: version.major + 1, minor: 0, patch: 0 });
    case 'minor':
      return formatSemver({ major: version.major, minor: version.minor + 1, patch: 0 });
    case 'patch':
      return formatSemver({ major: version.major, minor: version.minor, patch: version.patch + 1 });
    case 'premajor':
      return formatPrerelease({ major: version.major + 1, minor: 0, patch: 0 }, version);
    case 'preminor':
      return formatPrerelease({ major: version.major, minor: version.minor + 1, patch: 0 }, version);
    case 'prepatch':
      return formatPrerelease(
        { major: version.major, minor: version.minor, patch: version.patch + 1 },
        version,
      );
  }
}

export function parseSemver(version: string): {
  major: number;
  minor: number;
  patch: number;
  prerelease?: string;
} {
  const match = version.trim().match(
    /^(?<major>0|[1-9]\d*)\.(?<minor>0|[1-9]\d*)\.(?<patch>0|[1-9]\d*)(?:-(?<prerelease>[0-9A-Za-z.-]+))?(?:\+[0-9A-Za-z.-]+)?$/,
  );
  if (!match?.groups) {
    throw new Error(`unsupported semver version: ${version}`);
  }

  return {
    major: Number.parseInt(match.groups.major, 10),
    minor: Number.parseInt(match.groups.minor, 10),
    patch: Number.parseInt(match.groups.patch, 10),
    prerelease: match.groups.prerelease || undefined,
  };
}

export function formatSemver(version: {
  major: number;
  minor: number;
  patch: number;
  prerelease?: string;
}): string {
  const core = `${version.major}.${version.minor}.${version.patch}`;
  return version.prerelease ? `${core}-${version.prerelease}` : core;
}

async function performReleaseAt(opts: ReleaseOptions, cwd: string): Promise<ReleaseResult> {
  const snapshot = await getReleaseSnapshot(cwd);
  if (snapshot.dirty && !opts.dryRun) {
    throw new Error('working tree is dirty; commit or stash changes before releasing');
  }

  const nextVersion = calculateNextVersion(snapshot.currentVersion, opts.type);
  const tagName = `v${nextVersion}`;
  const changelogEntry = snapshot.unreleasedChanges || '- No changes recorded.';

  if (opts.dryRun) {
    return {
      version: nextVersion,
      changelog: changelogEntry,
      tag: tagName,
      published: false,
    };
  }

  const git = simpleGit({ baseDir: cwd });
  const originalPackageText = fs.readFileSync(snapshot.packagePath, 'utf8');
  const originalChangelogText = fs.existsSync(snapshot.changelogPath)
    ? fs.readFileSync(snapshot.changelogPath, 'utf8')
    : undefined;
  let packageUpdated = false;
  let changelogUpdated = false;
  let committed = false;

  try {
    const updatedPackage = {
      ...snapshot.packageJson,
      version: nextVersion,
    };
    fs.writeFileSync(snapshot.packagePath, `${JSON.stringify(updatedPackage, null, 2)}\n`, 'utf8');
    packageUpdated = true;

    const filesToAdd = ['package.json'];

    if (!opts.skipChangelog) {
      const nextChangelog = buildUpdatedChangelog(
        originalChangelogText,
        nextVersion,
        changelogEntry,
      );
      fs.writeFileSync(snapshot.changelogPath, nextChangelog, 'utf8');
      changelogUpdated = true;
      filesToAdd.push('CHANGELOG.md');
    }

    await git.add(filesToAdd);
    await git.commit(`chore(release): ${tagName}`);
    committed = true;

    if (!opts.skipTag) {
      await git.addTag(tagName);
    }

    let published = false;
    if (!opts.skipPublish) {
      runPublish(cwd, opts.tag);
      published = true;
      return {
        version: nextVersion,
        changelog: changelogEntry,
        tag: tagName,
        published,
      };
    }

    return {
      version: nextVersion,
      changelog: changelogEntry,
      tag: tagName,
      published: false,
    };
  } catch (error) {
    if (!committed) {
      if (packageUpdated) {
        fs.writeFileSync(snapshot.packagePath, originalPackageText, 'utf8');
      }
      if (changelogUpdated) {
        if (originalChangelogText === undefined) {
          fs.rmSync(snapshot.changelogPath, { force: true });
        } else {
          fs.writeFileSync(snapshot.changelogPath, originalChangelogText, 'utf8');
        }
      }
    }
    throw error;
  }
}

async function getReleaseSnapshot(cwd: string): Promise<ReleaseSnapshot> {
  const git = simpleGit({ baseDir: cwd });
  if (!(await git.checkIsRepo())) {
    throw new Error(`not a git repository: ${cwd}`);
  }

  const packagePath = path.join(cwd, 'package.json');
  const changelogPath = path.join(cwd, 'CHANGELOG.md');
  const packageJson = readPackageJson(packagePath);
  const currentVersion = readVersion(packageJson);
  const latestTag = (await git.tags()).latest ?? null;
  const commits = mapConventionalCommits(await readReleaseCommits(git, latestTag));
  const unreleasedChanges = renderConventionalChangelog(commits);
  const status = await git.status();

  return {
    cwd,
    packagePath,
    changelogPath,
    packageJson,
    currentVersion,
    latestTag,
    commits,
    unreleasedChanges,
    dirty: !status.isClean(),
  };
}

async function readReleaseCommits(
  git: ReturnType<typeof simpleGit>,
  latestTag: string | null,
): Promise<GitCommitEntry[]> {
  const range = latestTag ? [`${latestTag}..HEAD`] : ['HEAD'];
  const result = await git.log<GitCommitEntry>(range);
  return Array.from(result.all) as GitCommitEntry[];
}

function readPackageJson(packagePath: string): PackageJsonShape {
  try {
    return JSON.parse(fs.readFileSync(packagePath, 'utf8')) as PackageJsonShape;
  } catch (error) {
    throw new Error(`unable to read package.json: ${(error as Error).message}`);
  }
}

function readVersion(pkg: PackageJsonShape): string {
  if (typeof pkg.version !== 'string' || !pkg.version.trim()) {
    throw new Error('package.json is missing a valid version field');
  }
  parseSemver(pkg.version);
  return pkg.version;
}

function mapConventionalCommits(entries: GitCommitEntry[]): ConventionalCommit[] {
  return entries.map((entry) => {
    const raw = entry.message.trim();
    const match = raw.match(
      /^(?<type>[a-z]+)(?:\((?<scope>[^)]+)\))?(?<breaking>!)?: (?<description>.+)$/i,
    );
    const body = entry.body ?? '';
    const type = match?.groups?.type?.toLowerCase() ?? 'other';
    const scope = match?.groups?.scope || undefined;
    const description = match?.groups?.description?.trim() ?? raw;
    const breaking =
      match?.groups?.breaking === '!' || /BREAKING CHANGE:/i.test(raw) || /BREAKING CHANGE:/i.test(body);

    return {
      hash: entry.hash,
      shortHash: entry.hash.slice(0, 7),
      raw,
      description,
      type,
      scope,
      author: entry.author_name,
      date: entry.date,
      breaking,
    };
  });
}

function renderConventionalChangelog(commits: ConventionalCommit[]): string {
  if (commits.length === 0) {
    return '- No changes recorded.';
  }

  const sections = new Map<string, string[]>();
  for (const section of SECTION_ORDER) sections.set(section, []);

  for (const commit of commits) {
    if (commit.breaking) {
      sections.get('Breaking Changes')?.push(formatCommitLine(commit));
    }
    sections.get(sectionForCommit(commit.type))?.push(formatCommitLine(commit));
  }

  const lines: string[] = [];
  for (const section of SECTION_ORDER) {
    const items = sections.get(section) ?? [];
    if (items.length === 0) continue;
    lines.push(`### ${section}`, '', ...items, '');
  }

  return lines.join('\n').trim() || '- No changes recorded.';
}

function sectionForCommit(type: string): (typeof SECTION_ORDER)[number] {
  switch (type) {
    case 'feat':
      return 'Features';
    case 'fix':
      return 'Fixes';
    case 'docs':
      return 'Documentation';
    case 'perf':
      return 'Performance';
    case 'refactor':
      return 'Refactors';
    case 'test':
      return 'Tests';
    case 'build':
      return 'Build';
    case 'ci':
      return 'CI';
    case 'chore':
    case 'style':
      return 'Chores';
    case 'revert':
      return 'Reverts';
    default:
      return 'Other';
  }
}

function formatCommitLine(commit: ConventionalCommit): string {
  const scope = commit.scope ? `**${commit.scope}:** ` : '';
  return `- ${scope}${commit.description} (${commit.shortHash})`;
}

function buildUpdatedChangelog(
  currentChangelog: string | undefined,
  version: string,
  changelogEntry: string,
): string {
  const changelog = currentChangelog?.trim().length ? currentChangelog : DEFAULT_CHANGELOG.trimEnd();
  const releaseSection = `## [${version}] - ${new Date().toISOString().slice(0, 10)}\n\n${changelogEntry.trim()}\n`;
  const unreleasedHeading = /^## \[Unreleased\].*$/m;
  const match = unreleasedHeading.exec(changelog);

  if (!match) {
    const base = changelog.trimEnd();
    return `${base}\n\n## [Unreleased]\n\n${releaseSection}\n`;
  }

  const headingStart = match.index;
  const headingEnd = headingStart + match[0].length;
  const afterHeading = changelog.slice(headingEnd);
  const nextHeadingRelative = afterHeading.search(/\n## \[/);
  const sectionEnd = nextHeadingRelative === -1 ? changelog.length : headingEnd + nextHeadingRelative;
  const before = changelog.slice(0, headingStart);
  const after = changelog.slice(sectionEnd).replace(/^\r?\n/, '');
  const freshUnreleased = `${match[0]}\n\n`;
  const next = `${before}${freshUnreleased}${releaseSection}${after ? `\n${after}` : ''}`;
  return next.endsWith('\n') ? next : `${next}\n`;
}

function runPublish(cwd: string, distTag?: string): void {
  const args = ['publish'];
  if (distTag) {
    args.push('--tag', distTag);
  }

  const result = spawnSync('npm', args, {
    cwd,
    encoding: 'utf8',
    shell: process.platform === 'win32',
    stdio: 'pipe',
  });

  if (result.status !== 0) {
    const details = [result.stderr, result.stdout].filter(Boolean).join('\n').trim();
    throw new Error(details || `npm publish failed with exit ${result.status ?? 'unknown'}`);
  }
}

function formatPrerelease(
  target: { major: number; minor: number; patch: number },
  current: { major: number; minor: number; patch: number; prerelease?: string },
): string {
  const base = formatSemver(target);
  const sameCore =
    current.major === target.major && current.minor === target.minor && current.patch === target.patch;
  if (!sameCore || !current.prerelease) {
    return `${base}-0`;
  }

  const match = current.prerelease.match(/(?:^|\.)(\d+)$/);
  const next = match ? Number.parseInt(match[1], 10) + 1 : 0;
  return `${base}-${next}`;
}

function parseReleaseArgs(
  args: string[],
):
  | { mode: 'status' }
  | { mode: 'preview'; options: ReleaseOptions }
  | { mode: 'release'; options: ReleaseOptions } {
  const [first, ...rest] = args;
  if (!first) {
    throw new Error(
      'Usage: /release <major|minor|patch|premajor|preminor|prepatch> [--tag <dist-tag>] [--dry-run] [--skip-changelog] [--skip-tag] [--skip-publish] | /release preview [type] | /release status',
    );
  }

  if (first === 'status') {
    return { mode: 'status' };
  }

  if (first === 'preview') {
    const [maybeType, ...tail] = rest;
    const type = isReleaseType(maybeType) ? maybeType : 'patch';
    const optionArgs = isReleaseType(maybeType) ? tail : rest;
    return {
      mode: 'preview',
      options: parseReleaseOptions(type, optionArgs),
    };
  }

  if (!isReleaseType(first)) {
    throw new Error(
      'Usage: /release <major|minor|patch|premajor|preminor|prepatch> [--tag <dist-tag>] [--dry-run] [--skip-changelog] [--skip-tag] [--skip-publish] | /release preview [type] | /release status',
    );
  }

  return {
    mode: 'release',
    options: parseReleaseOptions(first, rest),
  };
}

function parseReleaseOptions(type: ReleaseType, args: string[]): ReleaseOptions {
  const options: ReleaseOptions = { type };

  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];

    switch (arg) {
      case '--tag': {
        const value = args[++index]?.trim();
        if (!value) {
          throw new Error('Usage: /release <type> [--tag <dist-tag>] [--dry-run] [--skip-changelog] [--skip-tag] [--skip-publish]');
        }
        options.tag = value;
        break;
      }
      case '--dry-run':
        options.dryRun = true;
        break;
      case '--skip-changelog':
        options.skipChangelog = true;
        break;
      case '--skip-tag':
        options.skipTag = true;
        break;
      case '--skip-publish':
        options.skipPublish = true;
        break;
      default:
        throw new Error('Usage: /release <type> [--tag <dist-tag>] [--dry-run] [--skip-changelog] [--skip-tag] [--skip-publish]');
    }
  }

  return options;
}

function isReleaseType(value: string | undefined): value is ReleaseType {
  return Boolean(value && RELEASE_TYPES.includes(value as ReleaseType));
}

function formatReleaseResult(result: ReleaseResult): string {
  return [
    theme.ok(`✔ release prepared: ${result.version}`),
    `  tag:       ${theme.hl(result.tag)}`,
    `  published: ${theme.hl(result.published ? 'yes' : 'no')}`,
    '',
    theme.brand('Changelog entry'),
    result.changelog,
    '',
  ].join('\n');
}

function formatPreview(result: ReleaseResult): string {
  return [
    theme.brand('Release preview'),
    `  version:   ${theme.hl(result.version)}`,
    `  tag:       ${theme.hl(result.tag)}`,
    `  published: ${theme.hl('no (dry run)')}`,
    '',
    theme.brand('Changelog preview'),
    result.changelog,
    '',
  ].join('\n');
}

function formatStatus(snapshot: ReleaseSnapshot): string {
  return [
    theme.brand('Release status'),
    `  cwd:               ${theme.dim(snapshot.cwd)}`,
    `  version:           ${theme.hl(snapshot.currentVersion)}`,
    `  latest tag:        ${theme.hl(snapshot.latestTag ?? 'none')}`,
    `  unreleased commits:${theme.hl(` ${snapshot.commits.length}`)}`,
    `  working tree:      ${theme.hl(snapshot.dirty ? 'dirty' : 'clean')}`,
    '',
    theme.brand('Unreleased changes'),
    snapshot.unreleasedChanges,
    '',
  ].join('\n');
}
