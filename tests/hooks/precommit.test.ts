import fs from 'node:fs';
import path from 'node:path';
import { EventEmitter } from 'node:events';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const gitState = vi.hoisted(() => ({
  diffResponses: new Map<string, string>(),
  rawResponse: '.git',
}));

const aiState = vi.hoisted(() => ({
  content: 'LGTM',
}));

const spawnState = vi.hoisted(() => ({
  calls: [] as Array<{ command: string; args: string[]; options: Record<string, unknown> }>,
  next: [] as Array<{ code: number; stdout?: string; stderr?: string }>,
}));

vi.mock('simple-git', () => ({
  default: vi.fn(() => ({
    diff: vi.fn(async (args: string[]) => gitState.diffResponses.get(args.join(' ')) ?? ''),
    raw: vi.fn(async () => gitState.rawResponse),
  })),
}));

vi.mock('node:child_process', () => ({
  spawn: vi.fn((command: string, args: string[] = [], options: Record<string, unknown> = {}) => {
    spawnState.calls.push({ command, args, options });
    const child = new EventEmitter() as EventEmitter & {
      stdout: EventEmitter;
      stderr: EventEmitter;
    };
    child.stdout = new EventEmitter();
    child.stderr = new EventEmitter();
    const next = spawnState.next.shift() ?? { code: 0 };
    queueMicrotask(() => {
      if (next.stdout) child.stdout.emit('data', next.stdout);
      if (next.stderr) child.stderr.emit('data', next.stderr);
      child.emit('exit', next.code);
    });
    return child;
  }),
}));

vi.mock('../../src/api/github-models.js', () => ({
  client: () => ({
    chat: {
      completions: {
        create: vi.fn(async () => ({
          choices: [{ message: { content: aiState.content } }],
        })),
      },
    },
  }),
  activeProvider: () => ({ name: 'test', maxTokens: 4096 }),
}));

import { config } from '../../src/config.js';
import {
  hookCommand,
  installHook,
  runPrecommitChecks,
  uninstallHook,
} from '../../src/hooks/precommit.js';

describe('precommit hook', () => {
  let tmpRoot: string;
  let tmpDir: string;
  let originalToken: string | undefined;
  let cwdSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    tmpRoot = path.join(process.cwd(), '.vitest-precommit-tmp');
    fs.mkdirSync(tmpRoot, { recursive: true });
    tmpDir = fs.mkdtempSync(path.join(tmpRoot, 'case-'));
    originalToken = config.token;
    config.token = 'test-token';
    cwdSpy = vi.spyOn(process, 'cwd').mockReturnValue(tmpDir);
    gitState.diffResponses.clear();
    gitState.rawResponse = '.git';
    aiState.content = 'LGTM';
    spawnState.calls.length = 0;
    spawnState.next.length = 0;
  });

  afterEach(() => {
    cwdSpy.mockRestore();
    config.token = originalToken;
    fs.rmSync(tmpRoot, { recursive: true, force: true });
    vi.clearAllMocks();
  });

  it('installs and uninstalls the git hook script', () => {
    const gitDir = path.join(tmpDir, '.git');
    installHook(gitDir);

    const hookPath = path.join(gitDir, 'hooks', 'pre-commit');
    expect(fs.existsSync(hookPath)).toBe(true);
    expect(fs.readFileSync(hookPath, 'utf8')).toContain('icopilot hook pre-commit');

    uninstallHook(gitDir);
    expect(fs.existsSync(hookPath)).toBe(false);
  });

  it('fails the security check when staged secrets are present', async () => {
    fs.mkdirSync(path.join(tmpDir, 'src'), { recursive: true });
    fs.writeFileSync(
      path.join(tmpDir, 'src', 'leak.ts'),
      'const token = "AbCdEfGhIjKlMnOpQrStUvWxYz012345";\n',
      'utf8',
    );
    gitState.diffResponses.set('--cached --name-only --diff-filter=ACMR', 'src/leak.ts\n');
    gitState.diffResponses.set(
      '--cached --unified=0 --no-color',
      'diff --git a/src/leak.ts b/src/leak.ts\n',
    );

    const result = await runPrecommitChecks({
      enabled: true,
      checks: ['security'],
      failOn: 'error',
    });

    expect(result.passed).toBe(false);
    expect(result.checks).toEqual([
      expect.objectContaining({
        name: 'security',
        passed: false,
        findings: [expect.stringContaining('src\\leak.ts:1 Generic secret')],
      }),
    ]);
  });

  it('treats review findings as warnings unless failOn=warning', async () => {
    fs.mkdirSync(path.join(tmpDir, 'src'), { recursive: true });
    fs.writeFileSync(path.join(tmpDir, 'src', 'app.ts'), 'export const answer = 42;\n', 'utf8');
    gitState.diffResponses.set('--cached --name-only --diff-filter=ACMR', 'src/app.ts\n');
    gitState.diffResponses.set(
      '--cached --unified=0 --no-color',
      'diff --git a/src/app.ts b/src/app.ts\n',
    );
    aiState.content = '- Missing regression test for the new branch';

    const errorOnly = await runPrecommitChecks({
      enabled: true,
      checks: ['review'],
      failOn: 'error',
    });
    const warningMode = await runPrecommitChecks({
      enabled: true,
      checks: ['review'],
      failOn: 'warning',
    });

    expect(errorOnly.passed).toBe(true);
    expect(errorOnly.checks[0]).toEqual(
      expect.objectContaining({
        name: 'review',
        passed: false,
        findings: ['Missing regression test for the new branch'],
      }),
    );
    expect(warningMode.passed).toBe(false);
  });

  it('runs lint and test commands for selected checks', async () => {
    fs.writeFileSync(
      path.join(tmpDir, 'package.json'),
      JSON.stringify(
        {
          scripts: { lint: 'eslint "src/**/*.ts"', test: 'vitest run' },
          devDependencies: { vitest: '^1.0.0' },
        },
        null,
        2,
      ),
      'utf8',
    );
    fs.writeFileSync(path.join(tmpDir, 'vitest.config.ts'), 'export default {};\n', 'utf8');
    fs.mkdirSync(path.join(tmpDir, 'tests'), { recursive: true });
    fs.writeFileSync(
      path.join(tmpDir, 'tests', 'hooked.test.ts'),
      'test("ok", () => {});\n',
      'utf8',
    );
    gitState.diffResponses.set('--cached --name-only --diff-filter=ACMR', 'tests/hooked.test.ts\n');
    gitState.diffResponses.set(
      '--cached --unified=0 --no-color',
      'diff --git a/tests/hooked.test.ts b/tests/hooked.test.ts\n',
    );
    spawnState.next.push({ code: 0 }, { code: 0 });

    const result = await runPrecommitChecks({
      enabled: true,
      checks: ['lint', 'test'],
      failOn: 'error',
    });

    expect(result.passed).toBe(true);
    expect(result.checks.map((check) => check.name)).toEqual(['lint', 'test']);
    expect(spawnState.calls).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ command: 'npm run lint' }),
        expect.objectContaining({ command: expect.stringContaining('npx') }),
      ]),
    );
    expect(spawnState.calls[1]?.command).toContain('tests/hooked.test.ts');
  });

  it('shows and edits project hook config', async () => {
    const show = await hookCommand(['config'], tmpDir);
    expect(show.output).toContain('Pre-commit config');
    expect(show.output).toContain('review, security');

    const update = await hookCommand(['config', 'checks', 'review,lint,test'], tmpDir);
    expect(update.exitCode).toBe(0);

    const configPath = path.join(tmpDir, '.icopilot', 'precommit.json');
    const saved = JSON.parse(fs.readFileSync(configPath, 'utf8')) as {
      checks: string[];
    };
    expect(saved.checks).toEqual(['review', 'lint', 'test']);
  });
});
