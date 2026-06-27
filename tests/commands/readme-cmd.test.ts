import fs from 'node:fs';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  analyzeProject,
  generateReadme,
  readmeCommand,
} from '../../src/commands/readme-cmd.js';
import { defaultContext } from '../../src/util/completion.js';

let baseDir: string;
let tmpDir: string;

beforeEach(() => {
  baseDir = path.join(process.cwd(), '.vitest-readme-cmd-tmp');
  fs.mkdirSync(baseDir, { recursive: true });
  tmpDir = fs.mkdtempSync(path.join(baseDir, 'case-'));
});

afterEach(() => {
  fs.rmSync(baseDir, { recursive: true, force: true });
});

function writeFixture(relativePath: string, content: string): void {
  const filePath = path.join(tmpDir, relativePath);
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, content, 'utf8');
}

function seedCliProject(): void {
  writeFixture('package-lock.json', '{}\n');
  writeFixture(
    'package.json',
    JSON.stringify(
      {
        name: 'fixture-cli',
        description: 'Generate fixture docs from project analysis.',
        version: '0.1.0',
        type: 'module',
        bin: {
          'fixture-cli': './bin/fixture.js',
        },
        main: './dist/index.js',
        scripts: {
          build: 'tsc -p .',
          test: 'vitest run',
          lint: 'eslint "src/**/*.ts"',
          start: 'node bin/fixture.js',
        },
        dependencies: {
          commander: '^12.1.0',
          chalk: '^5.3.0',
        },
        devDependencies: {
          typescript: '^5.5.4',
          vitest: '^1.6.0',
        },
        engines: {
          node: '>=18.17.0',
        },
        license: 'MIT',
      },
      null,
      2,
    ),
  );
  writeFixture(
    'bin/fixture.js',
    "#!/usr/bin/env node\nimport '../dist/index.js';\n",
  );
  writeFixture(
    'src/index.ts',
    [
      "import { Command } from 'commander';",
      '',
      'const program = new Command();',
      "program.name('fixture-cli').description('fixture cli');",
      "program.command('build-docs').description('build docs').action(() => {});",
      "program.command('doctor').description('doctor').action(() => {});",
      'program.parse();',
      '',
    ].join('\n'),
  );
  writeFixture('LICENSE', 'MIT License\n');
}

describe('readme-cmd', () => {
  it('analyzes a project and generates README sections from project metadata', () => {
    seedCliProject();

    const analysis = analyzeProject(tmpDir);
    const readme = generateReadme(tmpDir);

    expect(analysis).toEqual({
      name: 'fixture-cli',
      description: 'Generate fixture docs from project analysis.',
      language: 'TypeScript',
      packageManager: 'npm',
      scripts: {
        build: 'tsc -p .',
        lint: 'eslint "src/**/*.ts"',
        start: 'node bin/fixture.js',
        test: 'vitest run',
      },
      entry: 'bin/fixture.js',
      license: 'MIT',
    });
    expect(readme).toContain('# fixture-cli');
    expect(readme).toContain('Generate fixture docs from project analysis.');
    expect(readme).toContain('## Install');
    expect(readme).toContain('npm install');
    expect(readme).toContain('npm run build');
    expect(readme).toContain('npm link');
    expect(readme).toContain('## Usage');
    expect(readme).toContain('fixture-cli --help');
    expect(readme).toContain('fixture-cli build-docs');
    expect(readme).toContain('## API');
    expect(readme).toContain('CLI binaries: `fixture-cli`');
    expect(readme).toContain('CLI commands:');
    expect(readme).toContain('[prod] `chalk`');
    expect(readme).toContain('## Scripts');
    expect(readme).toContain('`build`: `tsc -p .`');
    expect(readme).toContain('## License');
    expect(readme).toContain('See [LICENSE](./LICENSE).');
  });

  it('supports preview mode without writing a README file', () => {
    seedCliProject();

    const output = readmeCommand(['preview'], tmpDir);

    expect(output).toContain('Generated README preview');
    expect(output).toContain('# fixture-cli');
    expect(fs.existsSync(path.join(tmpDir, 'README.md'))).toBe(false);
  });

  it('writes README.md and refuses to overwrite without an explicit flag', () => {
    seedCliProject();

    const first = readmeCommand([], tmpDir);
    const second = readmeCommand([], tmpDir);

    expect(first).toContain('Wrote README.md.');
    expect(fs.readFileSync(path.join(tmpDir, 'README.md'), 'utf8')).toContain('# fixture-cli');
    expect(second).toContain('README.md already exists.');
  });

  it('updates existing generated sections while preserving custom sections', () => {
    seedCliProject();
    writeFixture(
      'README.md',
      [
        '# fixture-cli',
        '',
        'Old intro',
        '',
        '## Usage',
        '',
        '```bash',
        'old usage',
        '```',
        '',
        '## Custom',
        '',
        'Keep me.',
        '',
      ].join('\n'),
    );

    const output = readmeCommand(['update', '--sections', 'usage,scripts'], tmpDir);
    const next = fs.readFileSync(path.join(tmpDir, 'README.md'), 'utf8');

    expect(output).toContain('Updated README.md.');
    expect(next).toContain('fixture-cli --help');
    expect(next).toContain('## Scripts');
    expect(next).toContain('## Custom');
    expect(next).toContain('Keep me.');
  });

  it('registers /readme for shell completion', () => {
    expect(defaultContext().slashCommands).toContain('readme');
  });
});
