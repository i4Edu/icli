import fs from 'node:fs';
import path from 'node:path';
import { theme } from '../ui/theme.js';

export interface LinterMatch {
  name: string;
  command: string;
  reason: string;
}

type PackageJson = {
  scripts?: Record<string, unknown>;
  dependencies?: Record<string, unknown>;
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

function hasEslintConfig(cwd: string): boolean {
  try {
    return fs.readdirSync(cwd).some((entry) => entry.startsWith('.eslintrc'));
  } catch {
    return false;
  }
}

function hasPackageDependency(pkg: PackageJson | undefined, dependency: string): boolean {
  return Boolean(pkg?.dependencies?.[dependency] || pkg?.devDependencies?.[dependency]);
}

function hasComposerPackage(cwd: string, packageNamePart: string): boolean {
  const text = readText(path.join(cwd, 'composer.json'));
  if (!text) return false;

  try {
    const composer = JSON.parse(text) as {
      require?: Record<string, unknown>;
      ['require-dev']?: Record<string, unknown>;
    };
    const deps = { ...composer.require, ...composer['require-dev'] };
    return Object.keys(deps).some((name) => name.includes(packageNamePart));
  } catch {
    return false;
  }
}

function fileContains(cwd: string, fileName: string, needle: string): boolean {
  return readText(path.join(cwd, fileName))?.includes(needle) ?? false;
}

export function detectLinters(cwd: string): LinterMatch[] {
  const matches: LinterMatch[] = [];
  const pkg = readPackageJson(cwd);
  const hasNpmLint = typeof pkg?.scripts?.lint === 'string';
  const hasEslintDep = hasPackageDependency(pkg, 'eslint');

  if (hasNpmLint) {
    matches.push({
      name: 'npm-lint',
      command: 'npm run lint',
      reason: 'package.json has "scripts.lint"',
    });
  }

  if (hasEslintDep) {
    matches.push({
      name: 'eslint',
      command: 'eslint .',
      reason: 'package.json has eslint as a dependency',
    });
  }

  if (!hasNpmLint && !hasEslintDep && hasEslintConfig(cwd)) {
    matches.push({
      name: 'eslint-config',
      command: 'npx eslint .',
      reason: '.eslintrc* is present',
    });
  }

  if (fileExists(cwd, 'ruff.toml') || fileContains(cwd, 'pyproject.toml', '[tool.ruff]')) {
    matches.push({
      name: 'ruff',
      command: 'ruff check .',
      reason: 'ruff configuration is present',
    });
  }

  if (fileExists(cwd, '.flake8') || fileContains(cwd, 'setup.cfg', '[flake8]')) {
    matches.push({
      name: 'flake8',
      command: 'flake8 .',
      reason: 'flake8 configuration is present',
    });
  }

  if (fileContains(cwd, 'pyproject.toml', '[tool.black]')) {
    matches.push({
      name: 'black',
      command: 'black --check .',
      reason: 'pyproject.toml contains [tool.black]',
    });
  }

  if (hasAnyFile(cwd, ['golangci.yml', '.golangci.yml', '.golangci.yaml'])) {
    matches.push({
      name: 'golangci-lint',
      command: 'golangci-lint run',
      reason: 'golangci-lint configuration is present',
    });
  }

  if (fileExists(cwd, 'Cargo.toml')) {
    matches.push({
      name: 'cargo-clippy',
      command: 'cargo clippy --all-targets -- -D warnings',
      reason: 'Cargo.toml is present',
    });
  }

  if (hasComposerPackage(cwd, 'phpstan')) {
    matches.push({
      name: 'phpstan',
      command: 'vendor/bin/phpstan',
      reason: 'composer.json has phpstan',
    });
  }

  return matches;
}

export function lintCommand(cwd: string): string {
  const matches = detectLinters(cwd);

  if (matches.length === 0) {
    return `${theme.warn('No supported linters detected.')}\n${theme.dim(
      'Add a lint script or linter configuration, then try /lint again.',
    )}\n`;
  }

  const lines = matches.map(
    (match) =>
      `  ${theme.ok(match.name)}  ${theme.hl(match.command)}  ${theme.dim(`(${match.reason})`)}`,
  );

  return `${theme.brand('Detected linters')}\n${lines.join('\n')}\n`;
}
