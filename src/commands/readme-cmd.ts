import fs from 'node:fs';
import path from 'node:path';
import { detectPackageManager } from './deps-cmd.js';
import { theme } from '../ui/theme.js';

export interface ReadmeOptions {
  template?: string;
  sections?: string[];
  overwrite?: boolean;
}

export interface ProjectAnalysis {
  name: string;
  description: string;
  language: string;
  packageManager: string;
  scripts: Record<string, string>;
  entry: string;
  license: string;
}

type SectionKey =
  | 'title'
  | 'badges'
  | 'description'
  | 'install'
  | 'usage'
  | 'api'
  | 'scripts'
  | 'contributing'
  | 'license';

interface DependencyInfo {
  name: string;
  version: string;
  type: 'prod' | 'dev';
}

interface PackageJsonShape {
  name?: string;
  description?: string;
  version?: string;
  license?: string;
  type?: string;
  main?: string;
  bin?: string | Record<string, string>;
  exports?: unknown;
  engines?: Record<string, string>;
  scripts?: Record<string, string>;
  dependencies?: Record<string, string>;
  devDependencies?: Record<string, string>;
}

interface ReadmeContext {
  analysis: ProjectAnalysis;
  packageJson?: PackageJsonShape;
  cliNames: string[];
  cliCommands: string[];
  exportsList: string[];
  dependencies: DependencyInfo[];
  installSteps: string[];
  usageExamples: string[];
  contributingFile?: string;
  rootDir: string;
}

interface ParsedCommand {
  mode: 'generate' | 'update' | 'preview';
  options: ReadmeOptions;
  error?: string;
}

const SECTION_ORDER: SectionKey[] = [
  'title',
  'badges',
  'description',
  'install',
  'usage',
  'api',
  'scripts',
  'contributing',
  'license',
];

const SECTION_HEADINGS: Record<Exclude<SectionKey, 'title' | 'badges' | 'description'>, string> = {
  install: 'Install',
  usage: 'Usage',
  api: 'API',
  scripts: 'Scripts',
  contributing: 'Contributing',
  license: 'License',
};

const README_NAME = 'README.md';

export function generateReadme(rootDir: string, opts: ReadmeOptions = {}): string {
  const ctx = analyzeReadmeContext(rootDir);
  const sections = resolveSections(opts);
  const blocks = renderBlocks(ctx);
  return sections
    .map((section) => blocks[section]?.trim())
    .filter((section): section is string => Boolean(section))
    .join('\n\n')
    .trim()
    .concat('\n');
}

export function analyzeProject(rootDir: string): ProjectAnalysis {
  return analyzeReadmeContext(rootDir).analysis;
}

export function readmeCommand(args: string[], cwd: string): string {
  const parsed = parseReadmeArgs(args);
  if (parsed.error) {
    return `${theme.warn(parsed.error)}\n`;
  }

  const readmePath = path.join(cwd, README_NAME);
  if (parsed.mode === 'preview') {
    return `${theme.brand('Generated README preview')}\n\n${generateReadme(cwd, parsed.options)}`;
  }

  if (parsed.mode === 'update') {
    const next = updateExistingReadme(cwd, parsed.options);
    fs.writeFileSync(readmePath, next, 'utf8');
    return `${theme.ok(`Updated ${README_NAME}.`)}\n`;
  }

  if (fs.existsSync(readmePath) && !parsed.options.overwrite) {
    return `${theme.warn(`${README_NAME} already exists.`)}\n${theme.dim(
      'Use /readme update, /readme preview, or /readme --overwrite.',
    )}\n`;
  }

  fs.writeFileSync(readmePath, generateReadme(cwd, parsed.options), 'utf8');
  return `${theme.ok(`Wrote ${README_NAME}.`)}\n`;
}

function analyzeReadmeContext(rootDir: string): ReadmeContext {
  const packageJson = readPackageJson(rootDir);
  const scripts = normalizeScripts(packageJson?.scripts);
  const cliNames = collectCliNames(packageJson);
  const entry = detectEntry(rootDir, packageJson);
  const analysis: ProjectAnalysis = {
    name: packageJson?.name?.trim() || path.basename(path.resolve(rootDir)),
    description:
      packageJson?.description?.trim() ||
      `Project scaffold for ${detectLanguage(rootDir, packageJson)} workflows.`,
    language: detectLanguage(rootDir, packageJson),
    packageManager: detectPackageManager(rootDir) ?? (packageJson ? 'npm' : 'unknown'),
    scripts,
    entry,
    license: detectLicense(rootDir, packageJson),
  };

  const entrySource = resolveEntrySource(rootDir, packageJson, entry);
  const entryText = entrySource ? safeRead(path.join(rootDir, entrySource)) : undefined;

  return {
    analysis,
    packageJson,
    cliNames,
    cliCommands: entryText ? scanCliCommands(entryText) : [],
    exportsList: collectExports(packageJson),
    dependencies: collectDependencies(packageJson),
    installSteps: buildInstallSteps(analysis, cliNames),
    usageExamples: buildUsageExamples(analysis, cliNames, entryText),
    contributingFile: detectContributingFile(rootDir),
    rootDir,
  };
}

function renderBlocks(ctx: ReadmeContext): Record<SectionKey, string> {
  return {
    title: `# ${ctx.analysis.name}`,
    badges: renderBadges(ctx),
    description: ctx.analysis.description,
    install: renderTitledSection('install', renderInstall(ctx)),
    usage: renderTitledSection('usage', renderUsage(ctx)),
    api: renderTitledSection('api', renderApi(ctx)),
    scripts: renderTitledSection('scripts', renderScripts(ctx)),
    contributing: renderTitledSection('contributing', renderContributing(ctx)),
    license: renderTitledSection('license', renderLicense(ctx)),
  };
}

function renderBadges(ctx: ReadmeContext): string {
  const badges: string[] = [];
  const engine = ctx.packageJson?.engines?.node;
  if (engine) {
    badges.push(
      `![Node](https://img.shields.io/badge/node-${encodeBadgeValue(engine)}-339933?logo=node.js)`,
    );
  }

  if (ctx.analysis.language !== 'Unknown') {
    const langColor =
      ctx.analysis.language === 'TypeScript'
        ? '3178C6'
        : ctx.analysis.language === 'JavaScript'
          ? 'F7DF1E'
          : '6E7781';
    badges.push(
      `![Language](https://img.shields.io/badge/language-${encodeBadgeValue(ctx.analysis.language)}-${langColor})`,
    );
  }

  if (ctx.analysis.license !== 'UNLICENSED') {
    badges.push(
      `![License](https://img.shields.io/badge/license-${encodeBadgeValue(ctx.analysis.license)}-blue.svg)`,
    );
  }

  return badges.join('\n');
}

function renderInstall(ctx: ReadmeContext): string {
  const lines = ctx.installSteps.length > 0 ? ctx.installSteps : defaultInstallSteps(ctx.analysis);
  return toCodeFence(lines);
}

function renderUsage(ctx: ReadmeContext): string {
  const examples =
    ctx.usageExamples.length > 0 ? ctx.usageExamples : defaultUsageExamples(ctx.analysis);
  return toCodeFence(examples);
}

function renderApi(ctx: ReadmeContext): string {
  const lines = [
    `- Language: ${ctx.analysis.language}`,
    `- Package manager: ${ctx.analysis.packageManager}`,
    `- Entry: \`${ctx.analysis.entry}\``,
  ];

  if (ctx.cliNames.length > 0) {
    lines.push(`- CLI binaries: ${ctx.cliNames.map((name) => `\`${name}\``).join(', ')}`);
  }

  if (ctx.exportsList.length > 0) {
    lines.push('- Exports:');
    for (const entry of ctx.exportsList) lines.push(`  - \`${entry}\``);
  }

  if (ctx.cliCommands.length > 0) {
    lines.push('- CLI commands:');
    for (const command of ctx.cliCommands.slice(0, 8)) lines.push(`  - \`${command}\``);
  }

  if (ctx.dependencies.length > 0) {
    lines.push('- Dependencies:');
    for (const dependency of ctx.dependencies.slice(0, 16)) {
      lines.push(`  - [${dependency.type}] \`${dependency.name}\` — ${dependency.version}`);
    }
  }

  return lines.join('\n');
}

function renderScripts(ctx: ReadmeContext): string {
  const entries = Object.entries(ctx.analysis.scripts);
  if (entries.length === 0) {
    return '- No package scripts were detected.';
  }

  return entries.map(([name, command]) => `- \`${name}\`: \`${command}\``).join('\n');
}

function renderContributing(ctx: ReadmeContext): string {
  const lines: string[] = [];
  if (ctx.contributingFile) {
    lines.push(
      `See [${ctx.contributingFile}](./${ctx.contributingFile}) for project-specific guidelines.`,
    );
  } else {
    lines.push(
      'Contributions are welcome. Start by installing dependencies and running the local quality checks:',
    );
  }

  const checks = buildContributingChecks(ctx.analysis);
  if (checks.length > 0) {
    lines.push('', ...checks.map((command) => `- \`${command}\``));
  }

  return lines.join('\n');
}

function renderLicense(ctx: ReadmeContext): string {
  const hasLicenseFile = fs.existsSync(path.join(ctx.rootDir, 'LICENSE'));
  return hasLicenseFile
    ? `Licensed under the ${ctx.analysis.license} license. See [LICENSE](./LICENSE).`
    : `Licensed under the ${ctx.analysis.license} license.`;
}

function renderTitledSection(
  section: Exclude<SectionKey, 'title' | 'badges' | 'description'>,
  body: string,
): string {
  return `## ${SECTION_HEADINGS[section]}\n\n${body.trim()}`;
}

function updateExistingReadme(rootDir: string, opts: ReadmeOptions): string {
  const readmePath = path.join(rootDir, README_NAME);
  if (!fs.existsSync(readmePath)) {
    return generateReadme(rootDir, opts);
  }

  const existing = fs.readFileSync(readmePath, 'utf8');
  const sections = resolveSections(opts);
  const blocks = renderBlocks(analyzeReadmeContext(rootDir));
  let next = existing;

  if (
    sections.some(
      (section) => section === 'title' || section === 'badges' || section === 'description',
    )
  ) {
    const preamble = SECTION_ORDER.filter(
      (section) =>
        (section === 'title' || section === 'badges' || section === 'description') &&
        sections.includes(section),
    )
      .map((section) => blocks[section].trim())
      .filter(Boolean)
      .join('\n\n');

    const firstHeadingMatch = next.match(/^##\s+/m);
    const suffix = firstHeadingMatch ? next.slice(firstHeadingMatch.index ?? 0).trimStart() : '';
    next = [preamble, suffix].filter(Boolean).join('\n\n').trim().concat('\n');
  }

  for (const section of sections) {
    if (section === 'title' || section === 'badges' || section === 'description') continue;
    next = replaceSection(next, SECTION_HEADINGS[section], blocks[section]);
  }

  return next.endsWith('\n') ? next : `${next}\n`;
}

function replaceSection(readme: string, heading: string, block: string): string {
  const escapedHeading = escapeRegExp(heading);
  const sectionPattern = new RegExp(`(^## ${escapedHeading}\\n[\\s\\S]*?)(?=^## \\S|\\Z)`, 'm');
  if (sectionPattern.test(readme)) {
    return readme.replace(sectionPattern, `${block.trim()}\n\n`);
  }

  return `${readme.trim()}\n\n${block.trim()}\n`;
}

function parseReadmeArgs(args: string[]): ParsedCommand {
  const options: ReadmeOptions = {};
  let mode: ParsedCommand['mode'] = 'generate';
  let index = 0;

  if (args[0] === 'preview' || args[0] === 'update') {
    mode = args[0];
    index = 1;
  }

  while (index < args.length) {
    const token = args[index]!;
    if (token === '--overwrite') {
      options.overwrite = true;
      index += 1;
      continue;
    }

    if (token === '--template') {
      const value = args[index + 1];
      if (!value)
        return {
          mode,
          options,
          error:
            'usage: /readme [preview|update] [--template <name>] [--sections a,b] [--overwrite]',
        };
      options.template = value;
      index += 2;
      continue;
    }

    if (token.startsWith('--template=')) {
      options.template = token.slice('--template='.length);
      index += 1;
      continue;
    }

    if (token === '--sections') {
      const value = args[index + 1];
      if (!value)
        return {
          mode,
          options,
          error:
            'usage: /readme [preview|update] [--template <name>] [--sections a,b] [--overwrite]',
        };
      options.sections = splitSections(value);
      index += 2;
      continue;
    }

    if (token.startsWith('--sections=')) {
      options.sections = splitSections(token.slice('--sections='.length));
      index += 1;
      continue;
    }

    return {
      mode,
      options,
      error: `unknown /readme argument: ${token}`,
    };
  }

  return { mode, options };
}

function resolveSections(opts: ReadmeOptions): SectionKey[] {
  const requested = (opts.sections ?? defaultSectionsForTemplate(opts.template))
    .map((section) => section.trim().toLowerCase())
    .filter(Boolean);

  const resolved = requested.filter((section): section is SectionKey =>
    SECTION_ORDER.includes(section as SectionKey),
  );

  return resolved.length > 0 ? resolved : [...SECTION_ORDER];
}

function defaultSectionsForTemplate(template?: string): string[] {
  if (template === 'minimal') {
    return ['title', 'description', 'install', 'usage', 'license'];
  }
  return [...SECTION_ORDER];
}

function splitSections(value: string): string[] {
  return value
    .split(',')
    .map((part) => part.trim())
    .filter(Boolean);
}

function readPackageJson(rootDir: string): PackageJsonShape | undefined {
  const packageJsonPath = path.join(rootDir, 'package.json');
  const text = safeRead(packageJsonPath);
  if (!text) return undefined;

  try {
    return JSON.parse(text) as PackageJsonShape;
  } catch {
    return undefined;
  }
}

function normalizeScripts(scripts?: Record<string, string>): Record<string, string> {
  return Object.fromEntries(
    Object.entries(scripts ?? {}).sort(([left], [right]) => left.localeCompare(right)),
  );
}

function collectCliNames(packageJson?: PackageJsonShape): string[] {
  if (!packageJson?.bin) return [];
  if (typeof packageJson.bin === 'string') {
    return packageJson.name ? [packageJson.name] : [];
  }

  return Object.keys(packageJson.bin).sort((left, right) => left.localeCompare(right));
}

function detectEntry(rootDir: string, packageJson?: PackageJsonShape): string {
  const binPath =
    typeof packageJson?.bin === 'string'
      ? packageJson.bin
      : packageJson?.bin
        ? Object.values(packageJson.bin)[0]
        : undefined;

  const normalizedBinPath = normalizeRelative(binPath);
  if (normalizedBinPath) return normalizedBinPath;
  if (packageJson?.main) return normalizeRelative(packageJson.main);

  const fallbacks = ['src/index.ts', 'src/cli.ts', 'index.ts', 'index.js'];
  for (const candidate of fallbacks) {
    if (fs.existsSync(path.join(rootDir, candidate))) return candidate;
  }

  return 'src/index.ts';
}

function resolveEntrySource(
  rootDir: string,
  packageJson: PackageJsonShape | undefined,
  entry: string,
): string | undefined {
  if (entry.endsWith('.ts') && fs.existsSync(path.join(rootDir, entry))) {
    return entry;
  }

  if (entry.endsWith('.js')) {
    const directTs = entry.replace(/^dist\//u, 'src/').replace(/\.js$/u, '.ts');
    if (fs.existsSync(path.join(rootDir, directTs))) return directTs;

    const entryText = safeRead(path.join(rootDir, entry));
    const distImport = entryText?.match(
      /(?:import\s+['"]\.\.\/dist\/([^'"]+)\.js['"]|require\(['"]\.\.\/dist\/([^'"]+)\.js['"]\))/u,
    );
    const sourceStem = distImport?.[1] ?? distImport?.[2];
    if (sourceStem) {
      const sourcePath = path.join('src', `${sourceStem}.ts`);
      if (fs.existsSync(path.join(rootDir, sourcePath))) return sourcePath;
    }
  }

  if (packageJson?.main) {
    const candidate = packageJson.main.replace(/^dist\//u, 'src/').replace(/\.js$/u, '.ts');
    if (fs.existsSync(path.join(rootDir, candidate))) return candidate;
  }

  return undefined;
}

function detectLanguage(rootDir: string, packageJson?: PackageJsonShape): string {
  if (fs.existsSync(path.join(rootDir, 'tsconfig.json'))) return 'TypeScript';
  if (hasFileWithExtension(rootDir, '.ts')) return 'TypeScript';
  if (packageJson?.type === 'module' || fs.existsSync(path.join(rootDir, 'package.json'))) {
    return 'JavaScript';
  }
  if (
    fs.existsSync(path.join(rootDir, 'pyproject.toml')) ||
    fs.existsSync(path.join(rootDir, 'requirements.txt'))
  ) {
    return 'Python';
  }
  return 'Unknown';
}

function detectLicense(rootDir: string, packageJson?: PackageJsonShape): string {
  if (packageJson?.license?.trim()) return packageJson.license.trim();
  const licenseText = safeRead(path.join(rootDir, 'LICENSE'));
  if (!licenseText) return 'UNLICENSED';
  const firstLine = licenseText.split(/\r?\n/u)[0]?.trim();
  return firstLine?.replace(/\s+License$/u, '') || 'UNLICENSED';
}

function collectDependencies(packageJson?: PackageJsonShape): DependencyInfo[] {
  const prod = Object.entries(packageJson?.dependencies ?? {}).map(([name, version]) => ({
    name,
    version,
    type: 'prod' as const,
  }));
  const dev = Object.entries(packageJson?.devDependencies ?? {}).map(([name, version]) => ({
    name,
    version,
    type: 'dev' as const,
  }));

  return [...prod, ...dev].sort((left, right) => left.name.localeCompare(right.name));
}

function buildInstallSteps(analysis: ProjectAnalysis, cliNames: string[]): string[] {
  switch (analysis.packageManager) {
    case 'npm':
      return cliNames.length > 0
        ? [
            'npm install',
            hasScript(analysis.scripts, 'build') ? 'npm run build' : '',
            'npm link',
          ].filter(Boolean)
        : ['npm install', hasScript(analysis.scripts, 'build') ? 'npm run build' : ''].filter(
            Boolean,
          );
    case 'pnpm':
      return cliNames.length > 0
        ? [
            'pnpm install',
            hasScript(analysis.scripts, 'build') ? 'pnpm run build' : '',
            'pnpm link --global',
          ].filter(Boolean)
        : ['pnpm install', hasScript(analysis.scripts, 'build') ? 'pnpm run build' : ''].filter(
            Boolean,
          );
    case 'yarn':
      return ['yarn install', hasScript(analysis.scripts, 'build') ? 'yarn build' : ''].filter(
        Boolean,
      );
    case 'pip':
      return ['pip install -r requirements.txt'];
    default:
      return defaultInstallSteps(analysis);
  }
}

function defaultInstallSteps(analysis: ProjectAnalysis): string[] {
  if (analysis.language === 'TypeScript' || analysis.language === 'JavaScript') {
    return ['npm install'];
  }
  return ['Follow the project-specific setup workflow for this repository.'];
}

function buildUsageExamples(
  analysis: ProjectAnalysis,
  cliNames: string[],
  entryText: string | undefined,
): string[] {
  const examples: string[] = [];
  const cli = cliNames[0];
  const commands = entryText ? scanCliCommands(entryText) : [];

  if (cli) {
    examples.push(`${cli} --help`);
    for (const command of commands.slice(0, 3)) {
      examples.push(`${cli} ${command}`);
    }
  }

  if (examples.length === 0 && hasScript(analysis.scripts, 'start')) {
    examples.push(runScriptCommand(analysis.packageManager, 'start'));
  }

  if (examples.length === 0 && analysis.entry) {
    examples.push(`node ${analysis.entry}`);
  }

  return unique(examples);
}

function defaultUsageExamples(analysis: ProjectAnalysis): string[] {
  if (hasScript(analysis.scripts, 'start')) {
    return [runScriptCommand(analysis.packageManager, 'start')];
  }
  return [`node ${analysis.entry}`];
}

function scanCliCommands(entryText: string): string[] {
  const commands = Array.from(entryText.matchAll(/\.command\(\s*['"`]([^'"`]+?)['"`]\s*\)/gu)).map(
    (match) => match[1]!.trim(),
  );
  return unique(commands);
}

function collectExports(packageJson?: PackageJsonShape): string[] {
  if (!packageJson) return [];
  const entries: string[] = [];
  flattenExports(packageJson.exports, '.', entries);
  if (entries.length === 0 && packageJson.main)
    entries.push(`main -> ${normalizeRelative(packageJson.main)}`);
  return unique(entries);
}

function flattenExports(value: unknown, key: string, acc: string[]): void {
  if (!value) return;
  if (typeof value === 'string') {
    acc.push(`${key} -> ${normalizeRelative(value)}`);
    return;
  }

  if (typeof value !== 'object' || Array.isArray(value)) return;
  for (const [nestedKey, nestedValue] of Object.entries(value as Record<string, unknown>)) {
    if (typeof nestedValue === 'string') {
      acc.push(
        `${key === '.' ? nestedKey : `${key}.${nestedKey}`} -> ${normalizeRelative(nestedValue)}`,
      );
      continue;
    }

    if (nestedValue && typeof nestedValue === 'object' && !Array.isArray(nestedValue)) {
      flattenExports(nestedValue, key === '.' ? nestedKey : `${key}.${nestedKey}`, acc);
    }
  }
}

function detectContributingFile(rootDir: string): string | undefined {
  const candidates = ['CONTRIBUTING.md', 'CONTRIBUTING', 'docs/CONTRIBUTING.md'];
  return candidates.find((candidate) => fs.existsSync(path.join(rootDir, candidate)));
}

function buildContributingChecks(analysis: ProjectAnalysis): string[] {
  const commands: string[] = [];
  if (hasScript(analysis.scripts, 'lint'))
    commands.push(runScriptCommand(analysis.packageManager, 'lint'));
  if (hasScript(analysis.scripts, 'test'))
    commands.push(runScriptCommand(analysis.packageManager, 'test'));
  if (hasScript(analysis.scripts, 'build'))
    commands.push(runScriptCommand(analysis.packageManager, 'build'));
  return unique(commands);
}

function runScriptCommand(packageManager: string, script: string): string {
  switch (packageManager) {
    case 'yarn':
      return `yarn ${script}`;
    case 'pnpm':
      return `pnpm run ${script}`;
    default:
      return `npm run ${script}`;
  }
}

function hasScript(scripts: Record<string, string>, name: string): boolean {
  return typeof scripts[name] === 'string' && scripts[name].length > 0;
}

function safeRead(filePath: string): string | undefined {
  try {
    return fs.readFileSync(filePath, 'utf8');
  } catch {
    return undefined;
  }
}

function hasFileWithExtension(rootDir: string, extension: string): boolean {
  const stack = [rootDir];
  while (stack.length > 0) {
    const dirPath = stack.pop()!;
    let entries: fs.Dirent[] = [];
    try {
      entries = fs.readdirSync(dirPath, { withFileTypes: true });
    } catch {
      continue;
    }

    for (const entry of entries) {
      if (entry.name === 'node_modules' || entry.name === '.git' || entry.name === 'dist') continue;
      const fullPath = path.join(dirPath, entry.name);
      if (entry.isDirectory()) {
        stack.push(fullPath);
      } else if (entry.isFile() && entry.name.endsWith(extension)) {
        return true;
      }
    }
  }

  return false;
}

function normalizeRelative(value?: string): string {
  if (!value) return '';
  return value
    .replace(/^[.][/\\]/u, '')
    .split(path.sep)
    .join('/');
}

function unique(values: string[]): string[] {
  return Array.from(new Set(values));
}

function toCodeFence(lines: string[]): string {
  return ['```bash', ...lines, '```'].join('\n');
}

function encodeBadgeValue(value: string): string {
  return encodeURIComponent(value).replace(/-/gu, '--');
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/gu, '\\$&');
}
