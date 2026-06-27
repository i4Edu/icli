import fs from 'node:fs';
import path from 'node:path';
import { theme } from '../ui/theme.js';

export interface TestFramework {
  name: string;
  command: string;
  reason: string;
}

type PackageJson = {
  scripts?: Record<string, unknown>;
  devDependencies?: Record<string, unknown>;
};

function readText(filePath: string): string | undefined {
  try {
    return fs.readFileSync(filePath, 'utf8');
  } catch {
    return undefined;
  }
}

function readPackageJson(cwd: string): PackageJson | undefined {
  const text = readText(path.join(cwd, 'package.json'));
  if (!text) return undefined;

  try {
    return JSON.parse(text) as PackageJson;
  } catch {
    return undefined;
  }
}

function fileExists(cwd: string, fileName: string): boolean {
  return fs.existsSync(path.join(cwd, fileName));
}

function hasAnyFile(cwd: string, fileNames: string[]): boolean {
  return fileNames.some((fileName) => fileExists(cwd, fileName));
}

function directoryHasFilePrefix(cwd: string, prefix: string): boolean {
  try {
    return fs.readdirSync(cwd).some((entry) => entry.startsWith(prefix));
  } catch {
    return false;
  }
}

function fileContains(cwd: string, fileName: string, needle: string): boolean {
  return readText(path.join(cwd, fileName))?.includes(needle) ?? false;
}

function hasGoTestFiles(dir: string): boolean {
  try {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const fullPath = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        if (entry.name === '.git' || entry.name === 'node_modules') continue;
        if (hasGoTestFiles(fullPath)) return true;
        continue;
      }

      if (entry.isFile() && entry.name.endsWith('_test.go')) return true;
    }
  } catch {
    return false;
  }

  return false;
}

export function detectTestFrameworks(cwd: string): TestFramework[] {
  const matches: TestFramework[] = [];
  const pkg = readPackageJson(cwd);

  if (typeof pkg?.scripts?.test === 'string') {
    matches.push({
      name: 'npm-test',
      command: 'npm test',
      reason: 'package.json has "scripts.test"',
    });
  }

  if (directoryHasFilePrefix(cwd, 'vitest.config.')) {
    matches.push({
      name: 'vitest',
      command: 'npx vitest run',
      reason: 'vitest.config.* is present',
    });
  }

  if (directoryHasFilePrefix(cwd, 'jest.config.')) {
    matches.push({
      name: 'jest',
      command: 'npx jest',
      reason: 'jest.config.* is present',
    });
  }

  if (pkg?.devDependencies?.mocha) {
    matches.push({
      name: 'mocha',
      command: 'npx mocha',
      reason: 'package.json has mocha in devDependencies',
    });
  }

  if (fileExists(cwd, 'pytest.ini') || fileContains(cwd, 'pyproject.toml', '[tool.pytest]')) {
    matches.push({
      name: 'pytest',
      command: 'pytest',
      reason: fileExists(cwd, 'pytest.ini')
        ? 'pytest.ini is present'
        : 'pyproject.toml contains [tool.pytest]',
    });
  }

  if (fileExists(cwd, 'Cargo.toml')) {
    matches.push({
      name: 'cargo-test',
      command: 'cargo test',
      reason: 'Cargo.toml is present',
    });
  }

  if (fileExists(cwd, 'go.mod')) {
    matches.push({
      name: 'go-test',
      command: 'go test ./...',
      reason: 'go.mod is present',
    });
  } else if (hasGoTestFiles(cwd)) {
    matches.push({
      name: 'go-test-files',
      command: 'go test ./...',
      reason: 'found *_test.go files',
    });
  }

  if (hasAnyFile(cwd, ['phpunit.xml', 'phpunit.xml.dist'])) {
    matches.push({
      name: 'phpunit',
      command: 'vendor/bin/phpunit',
      reason: fileExists(cwd, 'phpunit.xml')
        ? 'phpunit.xml is present'
        : 'phpunit.xml.dist is present',
    });
  }

  if (fileExists(cwd, '.rspec') || fileContains(cwd, 'Gemfile', 'rspec')) {
    matches.push({
      name: 'rspec',
      command: 'bundle exec rspec',
      reason: fileExists(cwd, '.rspec') ? '.rspec is present' : 'Gemfile mentions rspec',
    });
  }

  return matches;
}

export function testCommand(cwd: string): string {
  const matches = detectTestFrameworks(cwd);

  if (matches.length === 0) {
    return `${theme.warn('No supported test frameworks detected.')}\n${theme.dim(
      'Add a test script or framework configuration, then try /test again.',
    )}\n`;
  }

  const lines = matches.map(
    (match) =>
      `  ${theme.ok(match.name)}  ${theme.hl(match.command)}  ${theme.dim(`(${match.reason})`)}`,
  );

  return `${theme.brand('Detected test frameworks')}\n${lines.join('\n')}\n`;
}
