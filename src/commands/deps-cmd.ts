import fs from 'node:fs';
import path from 'node:path';
import { theme } from '../ui/theme.js';

export interface DependencyInfo {
  name: string;
  current: string;
  type: 'prod' | 'dev';
}

export interface DepsPayload {
  packageManager: string;
  dependencies: DependencyInfo[];
  prompt: string;
}

type PackageJson = {
  dependencies?: Record<string, string>;
  devDependencies?: Record<string, string>;
};

type PipfileLock = {
  default?: Record<string, { version?: string }>;
  develop?: Record<string, { version?: string }>;
};

const PACKAGE_MANAGERS: Array<{ file: string; name: string }> = [
  { file: 'package-lock.json', name: 'npm' },
  { file: 'yarn.lock', name: 'yarn' },
  { file: 'pnpm-lock.yaml', name: 'pnpm' },
  { file: 'Cargo.lock', name: 'cargo' },
  { file: 'go.sum', name: 'go' },
  { file: 'requirements.txt', name: 'pip' },
  { file: 'Pipfile.lock', name: 'pip' },
  { file: 'Gemfile.lock', name: 'bundler' },
];

function readText(filePath: string): string | undefined {
  try {
    return fs.readFileSync(filePath, 'utf8');
  } catch {
    return undefined;
  }
}

function readJson<T>(filePath: string): T | undefined {
  const text = readText(filePath);
  if (!text) return undefined;

  try {
    return JSON.parse(text) as T;
  } catch {
    return undefined;
  }
}

function uniqueDependencies(dependencies: DependencyInfo[]): DependencyInfo[] {
  const seen = new Set<string>();
  const unique: DependencyInfo[] = [];

  for (const dependency of dependencies) {
    const key = `${dependency.type}:${dependency.name}`;
    if (seen.has(key)) continue;
    seen.add(key);
    unique.push(dependency);
  }

  return unique.sort((left, right) => left.name.localeCompare(right.name));
}

function parsePackageJsonDependencies(cwd: string): DependencyInfo[] {
  const pkg = readJson<PackageJson>(path.join(cwd, 'package.json'));
  if (!pkg) return [];

  const prod = Object.entries(pkg.dependencies ?? {}).map(([name, current]) => ({
    name,
    current,
    type: 'prod' as const,
  }));
  const dev = Object.entries(pkg.devDependencies ?? {}).map(([name, current]) => ({
    name,
    current,
    type: 'dev' as const,
  }));

  return uniqueDependencies([...prod, ...dev]);
}

function extractRequirement(line: string): { name: string; current: string } | null {
  const trimmed = line.split('#')[0]?.trim();
  if (!trimmed || trimmed.startsWith('-')) return null;

  const match = /^([A-Za-z0-9._-]+)(?:\[[^\]]+\])?\s*([<>=!~].+)?$/u.exec(trimmed);
  if (!match) return null;

  const [, name, specifier] = match;
  return {
    name,
    current: specifier?.trim() || 'unspecified',
  };
}

function parseRequirementsDependencies(cwd: string): DependencyInfo[] {
  const requirements = readText(path.join(cwd, 'requirements.txt'));
  if (requirements) {
    return uniqueDependencies(
      requirements
        .split(/\r?\n/u)
        .map((line) => extractRequirement(line))
        .filter((dependency): dependency is { name: string; current: string } =>
          Boolean(dependency),
        )
        .map((dependency) => ({ ...dependency, type: 'prod' as const })),
    );
  }

  const pipfile = readJson<PipfileLock>(path.join(cwd, 'Pipfile.lock'));
  if (!pipfile) return [];

  const prod = Object.entries(pipfile.default ?? {}).map(([name, metadata]) => ({
    name,
    current: metadata.version ?? 'unspecified',
    type: 'prod' as const,
  }));
  const dev = Object.entries(pipfile.develop ?? {}).map(([name, metadata]) => ({
    name,
    current: metadata.version ?? 'unspecified',
    type: 'dev' as const,
  }));

  return uniqueDependencies([...prod, ...dev]);
}

function extractCargoVersion(value: string): string {
  const quoted = /"([^"]+)"/u.exec(value);
  if (quoted?.[1]) return quoted[1];

  const versionField = /version\s*=\s*"([^"]+)"/u.exec(value);
  if (versionField?.[1]) return versionField[1];

  return value.trim() || 'unspecified';
}

function parseCargoDependencies(cwd: string): DependencyInfo[] {
  const cargoToml = readText(path.join(cwd, 'Cargo.toml'));
  if (!cargoToml) return [];

  const dependencies: DependencyInfo[] = [];
  let currentType: 'prod' | 'dev' | null = null;

  for (const rawLine of cargoToml.split(/\r?\n/u)) {
    const line = rawLine.trim();
    if (!line || line.startsWith('#')) continue;

    if (line === '[dependencies]') {
      currentType = 'prod';
      continue;
    }

    if (line === '[dev-dependencies]') {
      currentType = 'dev';
      continue;
    }

    if (line.startsWith('[')) {
      currentType = null;
      continue;
    }

    if (!currentType) continue;

    const eqIndex = line.indexOf('=');
    if (eqIndex <= 0) continue;

    const name = line.slice(0, eqIndex).trim();
    const current = extractCargoVersion(line.slice(eqIndex + 1));
    dependencies.push({ name, current, type: currentType });
  }

  return uniqueDependencies(dependencies);
}

function parseGoDependencies(cwd: string): DependencyInfo[] {
  const goMod = readText(path.join(cwd, 'go.mod'));
  const dependencies: DependencyInfo[] = [];

  if (goMod) {
    let inRequireBlock = false;

    for (const rawLine of goMod.split(/\r?\n/u)) {
      const line = rawLine.trim();
      if (!line || line.startsWith('//')) continue;

      if (line === 'require (') {
        inRequireBlock = true;
        continue;
      }

      if (inRequireBlock && line === ')') {
        inRequireBlock = false;
        continue;
      }

      if (line.startsWith('require ')) {
        const parts = line.replace(/^require\s+/u, '').split(/\s+/u);
        if (parts.length >= 2) {
          dependencies.push({ name: parts[0]!, current: parts[1]!, type: 'prod' });
        }
        continue;
      }

      if (!inRequireBlock) continue;

      const parts = line.split(/\s+/u);
      if (parts.length >= 2) {
        dependencies.push({ name: parts[0]!, current: parts[1]!, type: 'prod' });
      }
    }
  }

  if (dependencies.length > 0) return uniqueDependencies(dependencies);

  const goSum = readText(path.join(cwd, 'go.sum'));
  if (!goSum) return [];

  for (const rawLine of goSum.split(/\r?\n/u)) {
    const line = rawLine.trim();
    if (!line) continue;

    const parts = line.split(/\s+/u);
    if (parts.length < 2 || parts[0]?.endsWith('/go.mod')) continue;
    dependencies.push({ name: parts[0]!, current: parts[1]!, type: 'prod' });
  }

  return uniqueDependencies(dependencies);
}

function parseBundlerDependencies(cwd: string): DependencyInfo[] {
  const gemfileLock = readText(path.join(cwd, 'Gemfile.lock'));
  if (!gemfileLock) return [];

  const dependencies: DependencyInfo[] = [];
  let inDependenciesSection = false;

  for (const rawLine of gemfileLock.split(/\r?\n/u)) {
    const line = rawLine.replace(/\t/gu, '    ');
    const trimmed = line.trim();

    if (trimmed === 'DEPENDENCIES') {
      inDependenciesSection = true;
      continue;
    }

    if (!inDependenciesSection) continue;
    if (!trimmed) break;
    if (/^[A-Z][A-Z\s]+$/u.test(trimmed)) break;

    const match = /^\s{2,}([A-Za-z0-9_.-]+)(?:\s+\(([^)]+)\))?$/u.exec(line);
    if (!match) continue;

    dependencies.push({
      name: match[1]!,
      current: match[2]?.trim() || 'unspecified',
      type: 'prod',
    });
  }

  return uniqueDependencies(dependencies);
}

function readDependencies(cwd: string, packageManager: string): DependencyInfo[] {
  switch (packageManager) {
    case 'npm':
    case 'yarn':
    case 'pnpm':
      return parsePackageJsonDependencies(cwd);
    case 'pip':
      return parseRequirementsDependencies(cwd);
    case 'cargo':
      return parseCargoDependencies(cwd);
    case 'go':
      return parseGoDependencies(cwd);
    case 'bundler':
      return parseBundlerDependencies(cwd);
    default:
      return [];
  }
}

function buildPrompt(packageManager: string, dependencies: DependencyInfo[]): string {
  const dependencyLines = dependencies.map(
    (dependency) => `- [${dependency.type}] ${dependency.name}: ${dependency.current}`,
  );

  return [
    `Analyze this ${packageManager} dependency list for the current project.`,
    'Focus on:',
    '1. Outdated packages or risky version pins',
    '2. Known security vulnerabilities to investigate',
    '3. Unnecessary or duplicate dependencies',
    '4. Dependency optimization and maintenance suggestions',
    '',
    'Dependencies:',
    ...dependencyLines,
  ].join('\n');
}

export function detectPackageManager(cwd: string): string | null {
  for (const entry of PACKAGE_MANAGERS) {
    if (fs.existsSync(path.join(cwd, entry.file))) {
      return entry.name;
    }
  }

  return null;
}

export function buildDepsPayload(cwd: string): DepsPayload | { error: string } {
  const packageManager = detectPackageManager(cwd);
  if (!packageManager) {
    return { error: 'No supported package manager detected in the current directory.' };
  }

  const dependencies = readDependencies(cwd, packageManager);
  return {
    packageManager,
    dependencies,
    prompt: buildPrompt(packageManager, dependencies),
  };
}

export function depsCommand(cwd: string): string {
  const payload = buildDepsPayload(cwd);
  if ('error' in payload) {
    return `${theme.warn(payload.error)}\n${theme.dim(
      'Supported manifests: package-lock.json, yarn.lock, pnpm-lock.yaml, Cargo.lock, go.sum, requirements.txt, Pipfile.lock, Gemfile.lock.',
    )}\n`;
  }

  const prodCount = payload.dependencies.filter((dependency) => dependency.type === 'prod').length;
  const devCount = payload.dependencies.length - prodCount;
  const preview = payload.dependencies
    .slice(0, 8)
    .map(
      (dependency) =>
        `  ${dependency.type === 'prod' ? theme.ok('prod') : theme.hl('dev ')}  ${dependency.name} ${theme.dim(`(${dependency.current})`)}`,
    );

  const remainder =
    payload.dependencies.length > preview.length
      ? [`  ${theme.dim(`…and ${payload.dependencies.length - preview.length} more`)}`]
      : [];

  return [
    theme.brand('Dependency overview'),
    `  package manager: ${theme.hl(payload.packageManager)}`,
    `  total dependencies: ${theme.hl(String(payload.dependencies.length))}`,
    `  prod: ${theme.ok(String(prodCount))}  dev: ${theme.hl(String(devCount))}`,
    `  summary: ${theme.dim(
      'Prompt ready for outdated package review, vulnerability checks, dependency cleanup, and optimization suggestions.',
    )}`,
    ...(preview.length > 0
      ? ['', ...preview, ...remainder]
      : ['', `  ${theme.dim('No dependencies parsed from the manifest.')}`]),
    '',
  ].join('\n');
}
