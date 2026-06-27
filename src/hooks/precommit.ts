import fs from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';
import simpleGit from 'simple-git';
import type { ChatCompletionMessageParam } from 'openai/resources/chat/completions';
import { activeProvider, client } from '../api/github-models.js';
import { detectLinters } from '../commands/lint-cmd.js';
import { scanFilesForSecrets } from '../commands/security-cmd.js';
import { detectTestFrameworks } from '../commands/test-cmd.js';
import { config } from '../config.js';
import { theme } from '../ui/theme.js';

export interface PrecommitConfig {
  enabled: boolean;
  checks: ('review' | 'security' | 'lint' | 'test')[];
  failOn: 'error' | 'warning' | 'never';
}

export interface CheckResult {
  name: 'review' | 'security' | 'lint' | 'test';
  passed: boolean;
  findings: string[];
  duration: number;
}

export interface PrecommitResult {
  passed: boolean;
  checks: CheckResult[];
}

export interface HookCommandResult {
  output: string;
  exitCode: number;
}

type CheckName = CheckResult['name'];
type FailureLevel = 'none' | 'warning' | 'error';

interface EvaluatedCheckResult extends CheckResult {
  failureLevel: FailureLevel;
}

interface StagedContext {
  cwd: string;
  files: string[];
  diff: string;
}

const HOOK_MARKER = '# managed by icopilot pre-commit hook';
const PRECOMMIT_USAGE = [
  theme.brand('Hook command'),
  `  ${theme.hl('/hook install')}               ${theme.dim('install the git pre-commit hook')}`,
  `  ${theme.hl('/hook uninstall')}             ${theme.dim('remove the git pre-commit hook')}`,
  `  ${theme.hl('/hook run')}                   ${theme.dim('run configured checks now')}`,
  `  ${theme.hl('/hook config')}                ${theme.dim('show current hook config')}`,
  `  ${theme.hl('/hook config enable|disable')} ${theme.dim('toggle the hook')}`,
  `  ${theme.hl('/hook config fail-on <mode>')} ${theme.dim('set error, warning, or never')}`,
  `  ${theme.hl('/hook config checks <list>')}  ${theme.dim('replace checks (comma-separated)')}`,
  `  ${theme.hl('/hook config add <check>')}    ${theme.dim('add review, security, lint, or test')}`,
  `  ${theme.hl('/hook config remove <check>')} ${theme.dim('remove a configured check')}`,
  `  ${theme.hl('/hook config reset')}          ${theme.dim('restore defaults')}`,
].join('\n');
const PRECOMMIT_CONFIG_FILE = path.join('.icopilot', 'precommit.json');
const REVIEW_PROMPT = `You are doing a fast pre-commit code review.
Return "LGTM" if the staged diff is clean.
Otherwise return a compact bullet list of concrete issues only. Focus on bugs, regressions, security problems, and missing tests.`;
const VALID_CHECKS: CheckName[] = ['review', 'security', 'lint', 'test'];
const DEFAULT_PRECOMMIT_CONFIG: PrecommitConfig = {
  enabled: true,
  checks: ['review', 'security'],
  failOn: 'error',
};
const MAX_FINDINGS = 20;

export function installHook(gitDir: string): void {
  const hooksDir = path.join(gitDir, 'hooks');
  const hookPath = path.join(hooksDir, 'pre-commit');
  fs.mkdirSync(hooksDir, { recursive: true });
  fs.writeFileSync(hookPath, buildHookScript(), 'utf8');
  try {
    fs.chmodSync(hookPath, 0o755);
  } catch {
    /* best effort on Windows */
  }
}

export function uninstallHook(gitDir: string): void {
  fs.rmSync(path.join(gitDir, 'hooks', 'pre-commit'), { force: true });
}

export async function runPrecommitChecks(
  precommitConfig: PrecommitConfig,
): Promise<PrecommitResult> {
  return toPublicResult(
    await runPrecommitChecksInternal(normalizePrecommitConfig(precommitConfig), process.cwd()),
  );
}

export function loadPrecommitConfig(cwd = config.cwd): PrecommitConfig {
  const filePath = getPrecommitConfigPath(cwd);
  try {
    if (!fs.existsSync(filePath))
      return { ...DEFAULT_PRECOMMIT_CONFIG, checks: [...DEFAULT_PRECOMMIT_CONFIG.checks] };
    const parsed = JSON.parse(fs.readFileSync(filePath, 'utf8')) as unknown;
    return normalizePrecommitConfig(parsed);
  } catch {
    return { ...DEFAULT_PRECOMMIT_CONFIG, checks: [...DEFAULT_PRECOMMIT_CONFIG.checks] };
  }
}

export function savePrecommitConfig(next: PrecommitConfig, cwd = config.cwd): PrecommitConfig {
  const normalized = normalizePrecommitConfig(next);
  const filePath = getPrecommitConfigPath(cwd);
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, `${JSON.stringify(normalized, null, 2)}\n`, 'utf8');
  return normalized;
}

export async function hookCommand(args: string[], cwd = config.cwd): Promise<HookCommandResult> {
  const [subcommand, ...rest] = args;
  const normalizedSubcommand = subcommand?.toLowerCase();

  if (!normalizedSubcommand) {
    return { output: `${PRECOMMIT_USAGE}\n`, exitCode: 0 };
  }

  switch (normalizedSubcommand) {
    case 'install': {
      const gitDir = await resolveGitDir(cwd);
      installHook(gitDir);
      const current = savePrecommitConfig(loadPrecommitConfig(cwd), cwd);
      return {
        output:
          `${theme.ok('✔ pre-commit hook installed')}\n` +
          `${theme.dim(path.join(gitDir, 'hooks', 'pre-commit'))}\n` +
          `${formatPrecommitConfig(current, cwd)}`,
        exitCode: 0,
      };
    }
    case 'uninstall': {
      const gitDir = await resolveGitDir(cwd);
      uninstallHook(gitDir);
      return {
        output: `${theme.ok('✔ pre-commit hook removed')}\n${theme.dim(path.join(gitDir, 'hooks', 'pre-commit'))}\n`,
        exitCode: 0,
      };
    }
    case 'run': {
      const current = loadPrecommitConfig(cwd);
      const result = await runPrecommitChecksInternal({ ...current, enabled: true }, cwd);
      return {
        output: formatPrecommitResult(result, current, cwd),
        exitCode: result.passed ? 0 : 1,
      };
    }
    case 'pre-commit': {
      const current = loadPrecommitConfig(cwd);
      if (!current.enabled) {
        return {
          output: `${theme.dim(`pre-commit hook disabled (${getPrecommitConfigPath(cwd)})`)}\n`,
          exitCode: 0,
        };
      }
      const result = await runPrecommitChecksInternal(current, cwd);
      return {
        output: formatPrecommitResult(result, current, cwd),
        exitCode: result.passed ? 0 : 1,
      };
    }
    case 'config':
      return handleConfigCommand(rest, cwd);
    default:
      return {
        output: `${theme.warn(`unknown hook subcommand: ${subcommand}`)}\n${PRECOMMIT_USAGE}\n`,
        exitCode: 1,
      };
  }
}

function buildHookScript(): string {
  return `#!/bin/sh
${HOOK_MARKER}
if command -v icopilot >/dev/null 2>&1; then
  exec icopilot hook pre-commit "$@"
fi

if command -v icli >/dev/null 2>&1; then
  exec icli hook pre-commit "$@"
fi

echo "icopilot is not installed on PATH." >&2
exit 1
`;
}

function getPrecommitConfigPath(cwd: string): string {
  return path.join(cwd, PRECOMMIT_CONFIG_FILE);
}

function normalizePrecommitConfig(input: unknown): PrecommitConfig {
  const candidate = input && typeof input === 'object' ? (input as Partial<PrecommitConfig>) : {};
  const enabled =
    typeof candidate.enabled === 'boolean' ? candidate.enabled : DEFAULT_PRECOMMIT_CONFIG.enabled;
  const failOn =
    candidate.failOn === 'error' || candidate.failOn === 'warning' || candidate.failOn === 'never'
      ? candidate.failOn
      : DEFAULT_PRECOMMIT_CONFIG.failOn;
  const checks = Array.isArray(candidate.checks)
    ? dedupeChecks(candidate.checks.filter(isCheckName))
    : [...DEFAULT_PRECOMMIT_CONFIG.checks];
  return {
    enabled,
    checks: checks.length ? checks : [...DEFAULT_PRECOMMIT_CONFIG.checks],
    failOn,
  };
}

function dedupeChecks(checks: CheckName[]): CheckName[] {
  return [...new Set(checks)];
}

function isCheckName(value: unknown): value is CheckName {
  return typeof value === 'string' && VALID_CHECKS.includes(value as CheckName);
}

async function handleConfigCommand(args: string[], cwd: string): Promise<HookCommandResult> {
  const current = loadPrecommitConfig(cwd);
  const [action, ...rest] = args;

  if (!action || action === 'show') {
    return { output: formatPrecommitConfig(current, cwd), exitCode: 0 };
  }

  switch (action.toLowerCase()) {
    case 'enable':
      return {
        output: `${theme.ok('✔ hook enabled')}\n${formatPrecommitConfig(savePrecommitConfig({ ...current, enabled: true }, cwd), cwd)}`,
        exitCode: 0,
      };
    case 'disable':
      return {
        output: `${theme.ok('✔ hook disabled')}\n${formatPrecommitConfig(savePrecommitConfig({ ...current, enabled: false }, cwd), cwd)}`,
        exitCode: 0,
      };
    case 'fail-on': {
      const value = rest[0];
      if (value !== 'error' && value !== 'warning' && value !== 'never') {
        return {
          output: `${theme.warn('usage: /hook config fail-on <error|warning|never>')}\n`,
          exitCode: 1,
        };
      }
      return {
        output: `${theme.ok(`✔ failOn → ${value}`)}\n${formatPrecommitConfig(savePrecommitConfig({ ...current, failOn: value }, cwd), cwd)}`,
        exitCode: 0,
      };
    }
    case 'checks': {
      const list = parseCheckList(rest.join(' '));
      if (!list.length) {
        return {
          output: `${theme.warn('usage: /hook config checks <review,security,lint,test>')}\n`,
          exitCode: 1,
        };
      }
      return {
        output: `${theme.ok(`✔ checks → ${list.join(', ')}`)}\n${formatPrecommitConfig(savePrecommitConfig({ ...current, checks: list }, cwd), cwd)}`,
        exitCode: 0,
      };
    }
    case 'add': {
      const check = rest[0];
      if (!isCheckName(check)) {
        return {
          output: `${theme.warn('usage: /hook config add <review|security|lint|test>')}\n`,
          exitCode: 1,
        };
      }
      return {
        output: `${theme.ok(`✔ added ${check}`)}\n${formatPrecommitConfig(savePrecommitConfig({ ...current, checks: dedupeChecks([...current.checks, check]) }, cwd), cwd)}`,
        exitCode: 0,
      };
    }
    case 'remove': {
      const check = rest[0];
      if (!isCheckName(check)) {
        return {
          output: `${theme.warn('usage: /hook config remove <review|security|lint|test>')}\n`,
          exitCode: 1,
        };
      }
      return {
        output: `${theme.ok(`✔ removed ${check}`)}\n${formatPrecommitConfig(savePrecommitConfig({ ...current, checks: current.checks.filter((entry) => entry !== check) }, cwd), cwd)}`,
        exitCode: 0,
      };
    }
    case 'reset':
      return {
        output: `${theme.ok('✔ hook config reset')}\n${formatPrecommitConfig(savePrecommitConfig(DEFAULT_PRECOMMIT_CONFIG, cwd), cwd)}`,
        exitCode: 0,
      };
    default:
      return {
        output: `${theme.warn(`unknown config action: ${action}`)}\n${PRECOMMIT_USAGE}\n`,
        exitCode: 1,
      };
  }
}

function parseCheckList(value: string): CheckName[] {
  const items = value
    .split(',')
    .map((entry) => entry.trim().toLowerCase())
    .filter(Boolean);
  return dedupeChecks(items.filter(isCheckName));
}

async function runPrecommitChecksInternal(
  precommitConfig: PrecommitConfig,
  cwd: string,
): Promise<{
  passed: boolean;
  checks: EvaluatedCheckResult[];
}> {
  if (!precommitConfig.enabled) {
    return { passed: true, checks: [] };
  }

  const staged = await getStagedContext(cwd);
  const checks: EvaluatedCheckResult[] = [];
  for (const name of precommitConfig.checks) {
    checks.push(await runCheck(name, staged));
  }

  return {
    passed: evaluateOverallPass(checks, precommitConfig.failOn),
    checks,
  };
}

async function getStagedContext(cwd: string): Promise<StagedContext> {
  const git = simpleGit({ baseDir: cwd });
  const filesRaw = await git.diff(['--cached', '--name-only', '--diff-filter=ACMR']);
  const files = filesRaw
    .split(/\r?\n/)
    .map((entry) => entry.trim())
    .filter(Boolean);
  const diff = files.length ? await git.diff(['--cached', '--unified=0', '--no-color']) : '';
  return { cwd, files, diff };
}

async function runCheck(name: CheckName, staged: StagedContext): Promise<EvaluatedCheckResult> {
  switch (name) {
    case 'review':
      return runReviewCheck(staged);
    case 'security':
      return runSecurityCheck(staged);
    case 'lint':
      return runLintCheck(staged);
    case 'test':
      return runTestCheck(staged);
  }
}

async function runReviewCheck(staged: StagedContext): Promise<EvaluatedCheckResult> {
  const startedAt = Date.now();
  if (!staged.diff.trim()) {
    return finalizeCheck('review', true, [], startedAt, 'none');
  }

  try {
    const provider = activeProvider();
    const messages: ChatCompletionMessageParam[] = [
      { role: 'system', content: REVIEW_PROMPT },
      {
        role: 'user',
        content: `Review this staged diff:\n\n${staged.diff.slice(0, 80_000)}`,
      },
    ];
    const response = await client().chat.completions.create({
      model: config.defaultModel,
      messages,
      temperature: 0.1,
      ...(provider?.maxTokens ? { max_tokens: provider.maxTokens } : {}),
    });
    const content = response.choices[0]?.message?.content?.trim() ?? '';
    if (!content || isCleanReview(content)) {
      return finalizeCheck('review', true, [], startedAt, 'none');
    }
    return finalizeCheck('review', false, summarizeText(content), startedAt, 'warning');
  } catch (error: any) {
    return finalizeCheck(
      'review',
      false,
      [`review failed: ${String(error?.message || error)}`],
      startedAt,
      'error',
    );
  }
}

function runSecurityCheck(staged: StagedContext): Promise<EvaluatedCheckResult> {
  const startedAt = Date.now();
  const findings = scanFilesForSecrets(staged.cwd, staged.files).map(
    (finding) => `${finding.file}:${finding.line} ${finding.pattern} (${finding.severity})`,
  );
  return Promise.resolve(
    finalizeCheck(
      'security',
      findings.length === 0,
      findings,
      startedAt,
      findings.length ? 'error' : 'none',
    ),
  );
}

async function runLintCheck(staged: StagedContext): Promise<EvaluatedCheckResult> {
  const startedAt = Date.now();
  const linters = detectLinters(staged.cwd);
  if (!linters.length) {
    return finalizeCheck('lint', false, ['No configured linter detected.'], startedAt, 'error');
  }

  const selection = buildLintCommand(linters, staged.files);
  const result = await executeCommand(selection.command, staged.cwd);
  const findings = result.code === 0 ? [] : summarizeText(result.output || 'Lint command failed.');
  return finalizeCheck(
    'lint',
    result.code === 0,
    findings,
    startedAt,
    result.code === 0 ? 'none' : 'error',
  );
}

async function runTestCheck(staged: StagedContext): Promise<EvaluatedCheckResult> {
  const startedAt = Date.now();
  const frameworks = detectTestFrameworks(staged.cwd);
  if (!frameworks.length) {
    return finalizeCheck(
      'test',
      false,
      ['No configured test runner detected.'],
      startedAt,
      'error',
    );
  }

  const selection = buildTestCommand(frameworks, staged.files);
  const result = await executeCommand(selection.command, staged.cwd);
  const findings = result.code === 0 ? [] : summarizeText(result.output || 'Test command failed.');
  return finalizeCheck(
    'test',
    result.code === 0,
    findings,
    startedAt,
    result.code === 0 ? 'none' : 'error',
  );
}

function buildLintCommand(
  linters: ReturnType<typeof detectLinters>,
  stagedFiles: string[],
): { command: string } {
  const preferred = linters.find((entry) => entry.name === 'npm-lint') ?? linters[0];
  const lintableFiles = stagedFiles.filter((file) =>
    /\.(?:[cm]?[jt]sx?|py|go|java|cs|php|rb)$/i.test(file),
  );

  if ((preferred.name === 'eslint' || preferred.name === 'eslint-config') && lintableFiles.length) {
    return { command: ['npx', 'eslint', ...lintableFiles].map(quoteArg).join(' ') };
  }

  return { command: preferred.command };
}

function buildTestCommand(
  frameworks: ReturnType<typeof detectTestFrameworks>,
  stagedFiles: string[],
): { command: string } {
  const testFiles = stagedFiles.filter((file) => /\.(?:test|spec)\.[cm]?[jt]sx?$/i.test(file));
  const preferred =
    frameworks.find((entry) => entry.name === 'vitest') ??
    frameworks.find((entry) => entry.name === 'jest') ??
    frameworks[0];

  if (preferred.name === 'vitest' && testFiles.length) {
    return { command: ['npx', 'vitest', 'run', ...testFiles].map(quoteArg).join(' ') };
  }

  if (preferred.name === 'jest' && testFiles.length) {
    return { command: ['npx', 'jest', ...testFiles].map(quoteArg).join(' ') };
  }

  return { command: preferred.command };
}

function executeCommand(command: string, cwd: string): Promise<{ code: number; output: string }> {
  return new Promise((resolve, reject) => {
    const child = spawn(command, [], {
      cwd,
      shell: true,
      windowsHide: true,
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let output = '';
    child.stdout.on('data', (chunk) => {
      output += String(chunk);
    });
    child.stderr.on('data', (chunk) => {
      output += String(chunk);
    });
    child.on('error', reject);
    child.on('exit', (code) => {
      resolve({ code: code ?? 1, output });
    });
  });
}

function summarizeText(text: string): string[] {
  return text
    .split(/\r?\n/)
    .map((line) => line.replace(/^\s*[-*]\s*/, '').trim())
    .filter(Boolean)
    .slice(0, MAX_FINDINGS);
}

function isCleanReview(content: string): boolean {
  return /^(?:lgtm|no issues found|looks good\b)/i.test(content.trim());
}

function evaluateOverallPass(
  checks: EvaluatedCheckResult[],
  failOn: PrecommitConfig['failOn'],
): boolean {
  if (failOn === 'never') return true;
  if (failOn === 'warning') return checks.every((check) => check.failureLevel === 'none');
  return checks.every((check) => check.failureLevel !== 'error');
}

function finalizeCheck(
  name: CheckName,
  passed: boolean,
  findings: string[],
  startedAt: number,
  failureLevel: FailureLevel,
): EvaluatedCheckResult {
  return {
    name,
    passed,
    findings,
    duration: Date.now() - startedAt,
    failureLevel,
  };
}

function toPublicResult(result: {
  passed: boolean;
  checks: EvaluatedCheckResult[];
}): PrecommitResult {
  return {
    passed: result.passed,
    checks: result.checks.map(({ failureLevel: _failureLevel, ...check }) => check),
  };
}

function formatPrecommitConfig(precommitConfig: PrecommitConfig, cwd: string): string {
  const configPath = getPrecommitConfigPath(cwd);
  return [
    theme.brand('Pre-commit config'),
    `  file:    ${theme.hl(configPath)}`,
    `  enabled: ${theme.hl(String(precommitConfig.enabled))}`,
    `  failOn:  ${theme.hl(precommitConfig.failOn)}`,
    `  checks:  ${theme.hl(precommitConfig.checks.join(', '))}`,
    '',
  ].join('\n');
}

function formatPrecommitResult(
  result: { passed: boolean; checks: EvaluatedCheckResult[] },
  precommitConfig: PrecommitConfig,
  cwd: string,
): string {
  const header = result.passed
    ? theme.ok('✔ pre-commit checks passed')
    : theme.err('✖ pre-commit checks failed');
  const lines = [
    header,
    theme.dim(`config: ${getPrecommitConfigPath(cwd)}  failOn=${precommitConfig.failOn}`),
    '',
  ];

  if (result.checks.length === 0) {
    lines.push(theme.dim('No checks ran.'));
  }

  for (const check of result.checks) {
    lines.push(
      `  ${check.passed ? theme.ok('✓') : theme.err('✗')} ${check.name} ${theme.dim(`(${check.duration}ms)`)}`,
    );
    for (const finding of check.findings) {
      lines.push(`    - ${finding}`);
    }
  }

  lines.push('');
  return `${lines.join('\n')}\n`;
}

async function resolveGitDir(cwd: string): Promise<string> {
  const git = simpleGit({ baseDir: cwd });
  const gitDir = (await git.raw(['rev-parse', '--git-dir'])).trim();
  return path.resolve(cwd, gitDir);
}

function quoteArg(value: string): string {
  return `"${value.replace(/(["\\$`])/g, '\\$1')}"`;
}
