import fs from 'node:fs';
import path from 'node:path';

export interface SummaryPayload {
  projectName: string;
  structure: string;
  prompt: string;
}

interface PackageJsonShape {
  name?: string;
  scripts?: Record<string, string>;
  dependencies?: Record<string, string>;
  devDependencies?: Record<string, string>;
}

const SKIP_NAMES = new Set(['node_modules', '.git', 'dist']);

export function buildSummary(cwd: string): SummaryPayload {
  const packageJson = readPackageJson(cwd);
  const projectName = packageJson?.name?.trim() || path.basename(path.resolve(cwd));
  const scripts = sortRecordEntries(packageJson?.scripts);
  const dependencies = sortKeys(packageJson?.dependencies);
  const devDependencies = sortKeys(packageJson?.devDependencies);
  const topLevelEntries = listTopLevelEntries(cwd);
  const detectedStack = detectStack(cwd, packageJson);

  const structure = [
    `Project: ${projectName}`,
    `Workspace: ${path.resolve(cwd)}`,
    '',
    'Detected stack:',
    ...formatList(detectedStack),
    '',
    'Top-level entries:',
    ...formatList(topLevelEntries),
    '',
    'Scripts:',
    ...formatKeyValueList(scripts),
    '',
    `Dependencies (${dependencies.length}):`,
    ...formatList(dependencies),
    '',
    `Dev dependencies (${devDependencies.length}):`,
    ...formatList(devDependencies),
  ].join('\n');

  const prompt = [
    `Summarize the architecture of the project "${projectName}" based on the workspace overview below.`,
    'Cover:',
    '1. The likely purpose of the project',
    '2. Primary languages, frameworks, and tooling',
    '3. Important top-level directories/files and their likely responsibilities',
    '4. Build, test, or run workflows implied by scripts/config',
    '5. Notable extension points, risks, or missing context',
    'If details are uncertain, say so explicitly.',
    '',
    structure,
  ].join('\n');

  return { projectName, structure, prompt };
}

function readPackageJson(cwd: string): PackageJsonShape | undefined {
  const packageJsonPath = path.join(cwd, 'package.json');
  if (!fs.existsSync(packageJsonPath)) {
    return undefined;
  }

  try {
    return JSON.parse(fs.readFileSync(packageJsonPath, 'utf8')) as PackageJsonShape;
  } catch {
    return undefined;
  }
}

function listTopLevelEntries(cwd: string): string[] {
  return fs
    .readdirSync(cwd, { withFileTypes: true })
    .filter((entry) => !SKIP_NAMES.has(entry.name))
    .sort((a, b) => a.name.localeCompare(b.name))
    .map((entry) => `${entry.name}${entry.isDirectory() ? '/' : ''}`);
}

function detectStack(cwd: string, packageJson?: PackageJsonShape): string[] {
  const detected = new Set<string>();
  const packageDeps = {
    ...packageJson?.dependencies,
    ...packageJson?.devDependencies,
  };

  if (packageJson) {
    detected.add('Node.js');
    if (
      hasAnyFile(cwd, ['tsconfig.json', 'tsconfig.base.json', 'tsconfig.build.json']) ||
      Boolean(packageDeps.typescript)
    ) {
      detected.add('TypeScript');
    } else {
      detected.add('JavaScript');
    }
  }

  if (hasAnyFile(cwd, ['pyproject.toml', 'requirements.txt', 'setup.py'])) {
    detected.add('Python');
  }
  if (fs.existsSync(path.join(cwd, 'Cargo.toml'))) {
    detected.add('Rust');
  }
  if (fs.existsSync(path.join(cwd, 'go.mod'))) {
    detected.add('Go');
  }
  if (hasAnyFile(cwd, ['pom.xml', 'build.gradle', 'build.gradle.kts'])) {
    detected.add('Java');
  }
  if (hasAnyMatch(cwd, (name) => name.endsWith('.csproj') || name.endsWith('.sln'))) {
    detected.add('.NET');
  }

  if (packageDeps.react) detected.add('React');
  if (packageDeps.next) detected.add('Next.js');
  if (packageDeps.vue) detected.add('Vue');
  if (packageDeps.nuxt) detected.add('Nuxt');
  if (packageDeps.svelte) detected.add('Svelte');
  if (packageDeps.express) detected.add('Express');
  if (packageDeps['@nestjs/core']) detected.add('NestJS');
  if (packageDeps.vitest) detected.add('Vitest');
  if (packageDeps.jest) detected.add('Jest');

  return Array.from(detected).sort((a, b) => a.localeCompare(b));
}

function hasAnyFile(cwd: string, fileNames: string[]): boolean {
  return fileNames.some((fileName) => fs.existsSync(path.join(cwd, fileName)));
}

function hasAnyMatch(cwd: string, match: (name: string) => boolean): boolean {
  return fs.readdirSync(cwd).some((entryName) => match(entryName));
}

function sortKeys(record?: Record<string, string>): string[] {
  return Object.keys(record ?? {}).sort((a, b) => a.localeCompare(b));
}

function sortRecordEntries(record?: Record<string, string>): Array<[string, string]> {
  return Object.entries(record ?? {}).sort(([left], [right]) => left.localeCompare(right));
}

function formatList(items: string[]): string[] {
  if (!items.length) {
    return ['- (none)'];
  }
  return items.map((item) => `- ${item}`);
}

function formatKeyValueList(items: Array<[string, string]>): string[] {
  if (!items.length) {
    return ['- (none)'];
  }
  return items.map(([key, value]) => `- ${key}: ${value}`);
}
