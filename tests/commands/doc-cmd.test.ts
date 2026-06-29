import fs from 'node:fs';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { defaultContext } from '../../src/util/completion.js';
import { docCommand, findUndocumented, generateDoc } from '../../src/commands/doc-cmd.js';

const compactSessionMock = vi.fn();
const runAutopilotMock = vi.hoisted(() => vi.fn());

vi.mock('../../src/commands/git.js', () => ({
  showDiff: vi.fn(),
  commitFromStaged: vi.fn(),
  prDescription: vi.fn(),
}));

vi.mock('../../src/context/compactor.js', () => ({
  compactSession: compactSessionMock,
}));

vi.mock('../../src/session/manager.js', () => ({
  pickSession: vi.fn(),
  exportSession: vi.fn(),
}));

vi.mock('../../src/commands/git-extra.js', () => ({
  reviewStaged: vi.fn(),
  draftIssue: vi.fn(),
  scaffoldBranch: vi.fn(),
}));

vi.mock('../../src/commands/index-cmd.js', () => ({
  indexCommand: vi.fn(),
}));

vi.mock('../../src/commands/diff-review-cmd.js', () => ({
  reviewDiff: vi.fn(),
}));

vi.mock('simple-git', () => ({
  default: () => ({
    checkIsRepo: vi.fn().mockResolvedValue(true),
    log: vi.fn().mockResolvedValue({ all: [] }),
    tags: vi.fn().mockResolvedValue({ latest: null }),
  }),
}));

vi.mock('../../src/commands/route-cmd.js', () => ({
  routeCommand: vi.fn(() => 'routing profile: fixed\n'),
}));

vi.mock('../../src/modes/autopilot.js', () => ({
  runAutopilot: runAutopilotMock,
}));

let tmpDir: string;

beforeEach(() => {
  fs.mkdirSync(path.join(process.cwd(), '.vitest-doc-cmd-tmp'), { recursive: true });
  tmpDir = fs.mkdtempSync(path.join(process.cwd(), '.vitest-doc-cmd-tmp', 'case-'));
});

afterEach(() => {
  fs.rmSync(path.join(process.cwd(), '.vitest-doc-cmd-tmp'), { recursive: true, force: true });
  vi.clearAllMocks();
});

function writeFixture(relativePath: string, content: string): string {
  const filePath = path.join(tmpDir, relativePath);
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, content, 'utf8');
  return filePath;
}

describe('generateDoc', () => {
  it('builds a JSDoc block with params, returns, and throws', () => {
    const doc = generateDoc(
      'export function sum(a: number, b: number) { throw new Error("x"); }',
      'jsdoc',
    );

    expect(doc).toContain('/**');
    expect(doc).toContain('@param a');
    expect(doc).toContain('@param b');
    expect(doc).toContain('@returns');
    expect(doc).toContain('@throws');
  });

  it('builds a TSDoc block without throws', () => {
    const doc = generateDoc(
      'export function sum(a: number, b: number): number { return a + b; }',
      'tsdoc',
    );

    expect(doc).toContain('@param a');
    expect(doc).toContain('@returns');
    expect(doc).not.toContain('@throws');
  });

  it('builds numpy and google style docstrings', () => {
    const numpy = generateDoc('def build(name, enabled=True):', 'numpy');
    const google = generateDoc('def build(name, enabled=True):', 'google');

    expect(numpy).toContain('Parameters');
    expect(numpy).toContain('Returns');
    expect(google).toContain('Args:');
    expect(google).toContain('Returns:');
  });
});

describe('findUndocumented', () => {
  it('finds undocumented exported symbols and skips documented ones', () => {
    writeFixture(
      'src/sample.ts',
      [
        '/** documented */',
        'export function documented() {',
        '  return true;',
        '}',
        '',
        'export function missing(value: string) {',
        '  return value;',
        '}',
        '',
        'export class MissingClass {}',
        '',
        'const localOnly = () => true;',
      ].join('\n'),
    );

    const symbols = findUndocumented(tmpDir);

    expect(symbols).toEqual([
      expect.objectContaining({ name: 'missing', kind: 'function', line: 6 }),
      expect.objectContaining({ name: 'MissingClass', kind: 'class', line: 10 }),
    ]);
  });
});

describe('docCommand', () => {
  it('generates docs for a specific symbol using inferred tsdoc style', () => {
    const filePath = writeFixture(
      'src/math.ts',
      [
        'export function add(left: number, right: number): number {',
        '  return left + right;',
        '}',
      ].join('\n'),
    );

    const result = docCommand([path.relative(tmpDir, filePath), 'add'], tmpDir);

    expect(result).toContain('Generated docs');
    expect(result).toContain('@param left');
    expect(result).toContain('@returns');
    expect(result).not.toContain('@throws');
  });

  it('lists undocumented exports for /doc --all', () => {
    writeFixture('src/a.ts', 'export const alpha = (value: string) => value;\n');

    const result = docCommand(['--all'], tmpDir);

    expect(result).toContain('Undocumented exports');
    expect(result).toContain('alpha');
  });
});

describe('slash and completion integration', { timeout: 20_000 }, () => {
  it('wires /doc into slash handling', () => {
    const slashSource = fs.readFileSync(
      path.join(process.cwd(), 'src', 'commands', 'slash.ts'),
      'utf8',
    );

    expect(slashSource).toContain("import { docCommand } from './doc-cmd.js';");
    expect(slashSource).toContain('/doc <file> [symbol]');
    expect(slashSource).toContain("case 'doc':");
    expect(slashSource).toContain('docCommand(rest, s.state.cwd)');
  });

  it('adds /doc to shell completion context', () => {
    expect(defaultContext().slashCommands).toContain('doc');
  });
});
