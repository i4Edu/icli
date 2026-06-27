import fs from 'node:fs';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { codegenCommand, generateModule } from '../../src/commands/codegen-cmd.js';
import { config } from '../../src/config.js';

let tmpRoot: string;
let tmpDir: string;
let originalCwd: string;

beforeEach(() => {
  tmpRoot = path.join(process.cwd(), '.vitest-codegen-cmd-tmp');
  fs.mkdirSync(tmpRoot, { recursive: true });
  tmpDir = fs.mkdtempSync(path.join(tmpRoot, 'case-'));
  originalCwd = config.cwd;
  config.cwd = tmpDir;
  fs.writeFileSync(path.join(tmpDir, 'tsconfig.json'), '{\n  "compilerOptions": {}\n}\n', 'utf8');
});

afterEach(() => {
  config.cwd = originalCwd;
  fs.rmSync(tmpRoot, { recursive: true, force: true });
});

function writeFixture(relativePath: string, content: string): void {
  const filePath = path.join(tmpDir, ...relativePath.split('/'));
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, content, 'utf8');
}

describe('generateModule', () => {
  it.each([
    ['command', 'session-summary-cmd.ts', 'sessionSummaryCommand', 'buildSessionSummaryPrompt'],
    ['tool', 'session-summary.ts', 'sessionSummaryTool', 'SESSION_SUMMARY_SCHEMA'],
    ['util', 'session-summary.ts', 'formatSessionSummaryMessage', 'normalizeSessionSummaryInput'],
    ['class', 'session-summary.ts', 'class SessionSummary', 'rename(nextName: string)'],
  ] as const)(
    'builds %s templates with a matching test file',
    (type, expectedFile, sourceNeedle, extraNeedle) => {
      const generated = generateModule({
        name: 'session-summary',
        description: `Create a ${type} for session summaries`,
        type,
      });

      expect(generated.paths.src).toContain(expectedFile);
      expect(generated.paths.test).toContain('.test.ts');
      expect(generated.source).toContain(sourceNeedle);
      expect(generated.source).toContain(extraNeedle);
      expect(generated.test).toContain('vitest');
      expect(generated.test).toContain('.js');
    },
  );
});

describe('codegenCommand', () => {
  it('writes command files and registers slash completion entries', () => {
    writeFixture(
      'src/commands/slash.ts',
      `import { buildGeneratePrompt } from './generate-cmd.js';

const HELP = \`
  /generate <goal>            generate a shell command for a goal
  /exit, /quit               quit iCopilot
\`;

export interface SlashContext {}

export function handleSlash(): void {
  switch ('generate') {
    case 'generate':
      return;
    case 'exit':
      return;
  }
}
`,
    );
    writeFixture(
      'src/util/completion.ts',
      `const defaultSlashCommands = [
  'generate',
  'exit',
];
`,
    );

    const output = codegenCommand(
      ['--type', 'command', '--name', 'session-summary', 'Generate a session summary command'],
      tmpDir,
    );

    expect(output).toContain('Codegen preview');
    expect(output).toContain('src/commands/session-summary-cmd.ts');
    expect(fs.existsSync(path.join(tmpDir, 'src', 'commands', 'session-summary-cmd.ts'))).toBe(true);
    expect(fs.existsSync(path.join(tmpDir, 'tests', 'commands', 'session-summary-cmd.test.ts'))).toBe(true);

    const slashText = fs.readFileSync(path.join(tmpDir, 'src', 'commands', 'slash.ts'), 'utf8');
    expect(slashText).toContain("import { sessionSummaryCommand } from './session-summary-cmd.js';");
    expect(slashText).toContain('/session-summary');
    expect(slashText).toContain("case 'session-summary':");

    const completionText = fs.readFileSync(path.join(tmpDir, 'src', 'util', 'completion.ts'), 'utf8');
    expect(completionText).toContain("'session-summary'");
  });

  it('registers generated tools in the tool registry', () => {
    writeFixture(
      'src/tools/registry.ts',
      `import { searchSymbols, searchSymbolsSchema } from './search-symbols.js';
import { webFetchTool, WEB_FETCH_SCHEMA } from './web.js';

type McpTools = {
  schemas: unknown[];
};

export const TOOL_SCHEMAS = [
  searchSymbolsSchema,
  WEB_FETCH_SCHEMA,
];

async function dispatchBuiltIn(name: string, args: Record<string, any>): Promise<string | undefined> {
  switch (name) {
    case 'search_symbols':
      return searchSymbols({ query: String(args.query || '') });
    default:
      return undefined;
  }
}
`,
    );

    const output = codegenCommand(
      ['--type=tool', '--name', 'session-summary', 'Generate a session summary tool'],
      tmpDir,
    );

    expect(output).toContain('src/tools/session-summary.ts');
    expect(fs.existsSync(path.join(tmpDir, 'src', 'tools', 'session-summary.ts'))).toBe(true);
    expect(fs.existsSync(path.join(tmpDir, 'tests', 'tools', 'session-summary.test.ts'))).toBe(true);

    const registryText = fs.readFileSync(path.join(tmpDir, 'src', 'tools', 'registry.ts'), 'utf8');
    expect(registryText).toContain(
      "import { sessionSummaryTool, SESSION_SUMMARY_SCHEMA } from './session-summary.js';",
    );
    expect(registryText).toContain('SESSION_SUMMARY_SCHEMA');
    expect(registryText).toContain("case 'session_summary':");
  });
});
