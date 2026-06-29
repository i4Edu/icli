import fs from 'node:fs';
import path from 'node:path';
import { createPatch } from 'diff';
import { config } from '../config.js';
import { theme } from '../ui/theme.js';

export interface CodegenOptions {
  name: string;
  description: string;
  type: 'command' | 'tool' | 'util' | 'class';
  language?: string;
}

interface ProjectLayout {
  root: string;
  srcDir: string;
  testsDir: string;
  extension: 'ts' | 'js';
}

interface NormalizedCodegenOptions extends CodegenOptions {
  extension: 'ts' | 'js';
  kebabName: string;
  camelName: string;
  pascalName: string;
  constantName: string;
  toolId: string;
}

interface PlannedChange {
  path: string;
  content: string;
  previous?: string;
}

const DEFAULT_SRC_DIR = 'src';
const DEFAULT_TESTS_DIR = 'tests';
const STOP_WORDS = new Set([
  'a',
  'an',
  'and',
  'auto',
  'build',
  'class',
  'command',
  'create',
  'file',
  'for',
  'generate',
  'module',
  'new',
  'slash',
  'test',
  'tests',
  'tool',
  'utility',
  'util',
  'with',
]);

export function generateModule(opts: CodegenOptions): {
  source: string;
  test: string;
  paths: { src: string; test: string };
} {
  const layout = detectProjectLayout();
  const normalized = normalizeOptions(opts, layout.extension);
  const paths = buildPaths(layout, normalized);
  const testImportPath = toImportPath(paths.test, paths.src);

  switch (normalized.type) {
    case 'command':
      return {
        source: commandTemplate(normalized),
        test: commandTestTemplate(normalized, testImportPath),
        paths,
      };
    case 'tool':
      return {
        source: toolTemplate(normalized),
        test: toolTestTemplate(normalized, testImportPath),
        paths,
      };
    case 'util':
      return {
        source: utilTemplate(normalized),
        test: utilTestTemplate(normalized, testImportPath),
        paths,
      };
    case 'class':
      return {
        source: classTemplate(normalized),
        test: classTestTemplate(normalized, testImportPath),
        paths,
      };
  }
}

export function codegenCommand(args: string[], cwd = config.cwd): string {
  const parsed = parseCodegenArgs(args);
  if ('error' in parsed) return `${theme.warn(parsed.error)}\n`;

  const root = path.resolve(cwd || process.cwd());
  const previousCwd = config.cwd;
  config.cwd = root;

  try {
    const generated = generateModule(parsed);
    const layout = detectProjectLayout();
    const normalized = normalizeOptions(parsed, layout.extension);
    const planned = collectPlannedChanges(root, layout, normalized, generated);
    const changed = planned.filter((entry) => entry.previous !== entry.content);

    const preview = changed.length > 0 ? renderPreview(changed) : theme.dim('No file changes required.');
    applyPlannedChanges(root, changed);

    const summary =
      changed.length === 0
        ? `${theme.dim('Everything is already up to date.')}\n`
        : `${theme.ok(`Generated ${changed.length} change(s).`)}\n${changed
            .map((entry) =>
              `  ${entry.previous === undefined ? theme.ok('created') : theme.ok('updated')} ${theme.hl(entry.path)}`,
            )
            .join('\n')}\n`;

    return `${theme.brand('Codegen preview')} ${theme.dim(
      `${normalized.type} ${normalized.kebabName}`,
    )}\n\n${preview}\n\n${summary}`;
  } finally {
    config.cwd = previousCwd;
  }
}

function parseCodegenArgs(args: string[]): CodegenOptions | { error: string } {
  let name = '';
  let description = '';
  let type: CodegenOptions['type'] | undefined;
  let language: string | undefined;
  const remaining: string[] = [];

  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index] ?? '';
    if (arg === '--name') {
      name = args[index + 1]?.trim() ?? '';
      index += 1;
      continue;
    }
    if (arg.startsWith('--name=')) {
      name = arg.slice('--name='.length).trim();
      continue;
    }
    if (arg === '--type') {
      const value = args[index + 1]?.trim().toLowerCase() ?? '';
      if (!isCodegenType(value)) {
        return { error: `unsupported codegen type: ${value || '(missing)'}` };
      }
      type = value;
      index += 1;
      continue;
    }
    if (arg.startsWith('--type=')) {
      const value = arg.slice('--type='.length).trim().toLowerCase();
      if (!isCodegenType(value)) return { error: `unsupported codegen type: ${value || '(missing)'}` };
      type = value;
      continue;
    }
    if (arg === '--language') {
      language = args[index + 1]?.trim();
      index += 1;
      continue;
    }
    if (arg.startsWith('--language=')) {
      language = arg.slice('--language='.length).trim();
      continue;
    }
    remaining.push(arg);
  }

  description = remaining.join(' ').trim();
  if (!description) {
    return {
      error:
        'usage: /codegen [--type command|tool|util|class] [--name slug] [--language ts|js] <description>',
    };
  }

  return {
    name: name || inferName(description),
    description,
    type: type ?? inferType(description),
    language,
  };
}

function isCodegenType(value: string): value is CodegenOptions['type'] {
  return value === 'command' || value === 'tool' || value === 'util' || value === 'class';
}

function inferType(description: string): CodegenOptions['type'] {
  const lower = description.toLowerCase();
  if (/\b(tool|schema|registry)\b/.test(lower)) return 'tool';
  if (/\b(class|service|manager|client)\b/.test(lower)) return 'class';
  if (/\b(command|slash)\b/.test(lower)) return 'command';
  return 'util';
}

function inferName(description: string): string {
  const words = description
    .toLowerCase()
    .replace(/[^a-z0-9\s-]/g, ' ')
    .split(/\s+/)
    .filter(Boolean);
  const filtered = words.filter((word) => !STOP_WORDS.has(word));
  const source = filtered.length > 0 ? filtered : words;
  return toKebabCase(source.slice(0, 4).join('-') || 'generated-module');
}

function detectProjectLayout(): ProjectLayout {
  const root = path.resolve(config.cwd || process.cwd());
  const srcDir = resolveProjectDir(root, [DEFAULT_SRC_DIR, 'lib', 'source']) ?? DEFAULT_SRC_DIR;
  const testsDir = resolveProjectDir(root, [DEFAULT_TESTS_DIR, 'test', '__tests__']) ?? DEFAULT_TESTS_DIR;
  const extension: 'ts' | 'js' = fs.existsSync(path.join(root, 'tsconfig.json')) ? 'ts' : 'js';

  return { root, srcDir, testsDir, extension };
}

function resolveProjectDir(root: string, candidates: string[]): string | undefined {
  return candidates.find((candidate) => fs.existsSync(path.join(root, candidate)));
}

function normalizeOptions(
  opts: CodegenOptions,
  defaultExtension: 'ts' | 'js',
): NormalizedCodegenOptions {
  const kebabName = toKebabCase(opts.name || inferName(opts.description));
  const extension = normalizeExtension(opts.language, defaultExtension);

  return {
    ...opts,
    name: kebabName,
    extension,
    kebabName,
    camelName: toCamelCase(kebabName),
    pascalName: toPascalCase(kebabName),
    constantName: toConstantCase(kebabName),
    toolId: kebabName.replace(/-/g, '_'),
  };
}

function normalizeExtension(language: string | undefined, defaultExtension: 'ts' | 'js'): 'ts' | 'js' {
  if (!language) return defaultExtension;
  const normalized = language.trim().toLowerCase();
  if (normalized === 'js' || normalized === 'javascript') return 'js';
  if (normalized === 'ts' || normalized === 'typescript') return 'ts';
  return defaultExtension;
}

function buildPaths(
  layout: ProjectLayout,
  opts: NormalizedCodegenOptions,
): { src: string; test: string } {
  const extension = opts.extension;
  switch (opts.type) {
    case 'command':
      return {
        src: `${layout.srcDir}/commands/${opts.kebabName}-cmd.${extension}`,
        test: `${layout.testsDir}/commands/${opts.kebabName}-cmd.test.${extension}`,
      };
    case 'tool':
      return {
        src: `${layout.srcDir}/tools/${opts.kebabName}.${extension}`,
        test: `${layout.testsDir}/tools/${opts.kebabName}.test.${extension}`,
      };
    case 'util':
      return {
        src: `${layout.srcDir}/util/${opts.kebabName}.${extension}`,
        test: `${layout.testsDir}/util/${opts.kebabName}.test.${extension}`,
      };
    case 'class':
      return {
        src: `${layout.srcDir}/${opts.kebabName}.${extension}`,
        test: `${layout.testsDir}/${opts.kebabName}.test.${extension}`,
      };
  }
}

function collectPlannedChanges(
  root: string,
  layout: ProjectLayout,
  opts: NormalizedCodegenOptions,
  generated: { source: string; test: string; paths: { src: string; test: string } },
): PlannedChange[] {
  const changes: PlannedChange[] = [
    planFileChange(root, generated.paths.src, generated.source),
    planFileChange(root, generated.paths.test, generated.test),
  ];

  if (opts.type === 'command') {
    changes.push(...buildCommandRegistrations(root, layout, opts));
  }
  if (opts.type === 'tool') {
    changes.push(...buildToolRegistrations(root, layout, opts));
  }

  return dedupeChanges(changes);
}

function planFileChange(root: string, relativePath: string, content: string): PlannedChange {
  const absolutePath = path.join(root, ...relativePath.split('/'));
  return {
    path: relativePath,
    content,
    previous: readIfExists(absolutePath),
  };
}

function buildCommandRegistrations(
  root: string,
  layout: ProjectLayout,
  opts: NormalizedCodegenOptions,
): PlannedChange[] {
  const slashPath = `${layout.srcDir}/commands/slash.ts`;
  const completionPath = `${layout.srcDir}/util/completion.ts`;
  const changes: PlannedChange[] = [];

  const slashAbsolute = path.join(root, ...slashPath.split('/'));
  const slashContent = readIfExists(slashAbsolute);
  if (slashContent !== undefined) {
    const updated = updateSlashRegistry(slashContent, opts);
    changes.push({ path: slashPath, previous: slashContent, content: updated });
  }

  const completionAbsolute = path.join(root, ...completionPath.split('/'));
  const completionContent = readIfExists(completionAbsolute);
  if (completionContent !== undefined) {
    const updated = updateCompletionRegistry(completionContent, opts);
    changes.push({ path: completionPath, previous: completionContent, content: updated });
  }

  return changes;
}

function buildToolRegistrations(
  root: string,
  layout: ProjectLayout,
  opts: NormalizedCodegenOptions,
): PlannedChange[] {
  const registryPath = `${layout.srcDir}/tools/registry.ts`;
  const absolutePath = path.join(root, ...registryPath.split('/'));
  const content = readIfExists(absolutePath);
  if (content === undefined) return [];

  const updated = updateToolRegistry(content, opts);
  return [{ path: registryPath, previous: content, content: updated }];
}

function updateSlashRegistry(content: string, opts: NormalizedCodegenOptions): string {
  const importLine = `import { ${opts.camelName}Command } from './${opts.kebabName}-cmd.js';\n`;
  const helpLine = `  /${opts.kebabName.padEnd(24)} ${summarizeDescription(opts.description, 44)}\n`;
  const caseBlock =
    `    case '${opts.kebabName}':\n` +
    `      process.stdout.write(${opts.camelName}Command(rest));\n` +
    '      return done();\n';

  let updated = insertBeforeMarker(content, 'export interface SlashContext {', importLine);
  updated = insertBeforeMarker(updated, "  /exit, /quit", helpLine);
  updated = insertBeforeMarker(updated, "    case 'exit':", caseBlock);
  return updated;
}

function updateCompletionRegistry(content: string, opts: NormalizedCodegenOptions): string {
  return insertBeforeMarker(content, "  'exit',", `  '${opts.kebabName}',\n`);
}

function updateToolRegistry(content: string, opts: NormalizedCodegenOptions): string {
  const importLine = `import { ${opts.camelName}Tool, ${opts.constantName}_SCHEMA } from './${opts.kebabName}.js';\n`;
  const schemaLine = `  ${opts.constantName}_SCHEMA,\n`;
  const caseBlock =
    `    case '${opts.toolId}':\n` +
    `      return ${opts.camelName}Tool({ input: String(args.input ?? '') });\n`;

  let updated = insertBeforeMarker(content, 'type McpTools = {', importLine);
  updated = insertBeforeMarker(updated, '  searchSymbolsSchema,', schemaLine);
  updated = insertBeforeMarker(updated, "    case 'search_symbols':", caseBlock);
  return updated;
}

function insertBeforeMarker(content: string, marker: string, insertion: string): string {
  if (content.includes(insertion.trim())) return content;
  const index = content.indexOf(marker);
  if (index === -1) {
    return content.endsWith('\n') ? `${content}${insertion}` : `${content}\n${insertion}`;
  }
  return `${content.slice(0, index)}${insertion}${content.slice(index)}`;
}

function dedupeChanges(changes: PlannedChange[]): PlannedChange[] {
  const byPath = new Map<string, PlannedChange>();
  for (const change of changes) byPath.set(change.path, change);
  return [...byPath.values()];
}

function renderPreview(changes: PlannedChange[]): string {
  return changes
    .map((change) =>
      createPatch(
        change.path,
        change.previous ?? '',
        change.content,
        change.previous === undefined ? 'empty' : 'current',
        'generated',
      ).trimEnd(),
    )
    .join('\n\n');
}

function applyPlannedChanges(root: string, changes: PlannedChange[]): void {
  for (const change of changes) {
    const absolutePath = path.join(root, ...change.path.split('/'));
    fs.mkdirSync(path.dirname(absolutePath), { recursive: true });
    fs.writeFileSync(absolutePath, change.content, 'utf8');
  }
}

function readIfExists(filePath: string): string | undefined {
  try {
    return fs.readFileSync(filePath, 'utf8');
  } catch {
    return undefined;
  }
}

function commandTemplate(opts: NormalizedCodegenOptions): string {
  return `import { theme } from '../ui/theme.js';

export interface ${opts.pascalName}Payload {
  target: string;
  prompt: string;
}

export function build${opts.pascalName}Prompt(target: string): ${opts.pascalName}Payload {
  const normalized = target.trim();
  const prompt = [
    'Implement the following slash command workflow.',
    'Keep the generated behavior concise and reviewable.',
    'Command: /${opts.kebabName}',
    \`Request: \${normalized}\`,
    'Notes: ${escapeSingleLine(opts.description)}',
  ].join('\\n');

  return {
    target: normalized,
    prompt,
  };
}

export function ${opts.camelName}Command(args: string[]): string {
  const target = args.join(' ').trim();
  if (!target) return \`\${theme.warn('usage: /${opts.kebabName} <target>')}\\n\`;

  const payload = build${opts.pascalName}Prompt(target);
  return \`\${theme.brand('${opts.pascalName} prompt')} \${theme.dim(payload.target)}\\n\\n\${payload.prompt}\\n\`;
}
`;
}

function commandTestTemplate(opts: NormalizedCodegenOptions, importPath: string): string {
  return `import { describe, expect, it } from 'vitest';
import { build${opts.pascalName}Prompt, ${opts.camelName}Command } from '${importPath}';

describe('${opts.camelName}Command', () => {
  it('shows usage when no target is supplied', () => {
    expect(${opts.camelName}Command([])).toContain('usage: /${opts.kebabName} <target>');
  });

  it('builds a prompt for the requested target', () => {
    const payload = build${opts.pascalName}Prompt('example target');

    expect(payload.target).toBe('example target');
    expect(payload.prompt).toContain('Command: /${opts.kebabName}');
    expect(${opts.camelName}Command(['example', 'target'])).toContain('${opts.pascalName} prompt');
  });
});
`;
}

function toolTemplate(opts: NormalizedCodegenOptions): string {
  return `import type { ChatCompletionTool } from 'openai/resources/chat/completions';

export interface ${opts.pascalName}ToolArgs {
  input: string;
}

export const ${opts.constantName}_SCHEMA: ChatCompletionTool = {
  type: 'function',
  function: {
    name: '${opts.toolId}',
    description: '${escapeSingleLine(opts.description)}',
    parameters: {
      type: 'object',
      properties: {
        input: {
          type: 'string',
          description: 'Primary input for ${opts.kebabName}.',
        },
      },
      required: ['input'],
    },
  },
};

export async function ${opts.camelName}Tool(args: ${opts.pascalName}ToolArgs): Promise<string> {
  const input = args.input.trim();
  return JSON.stringify({
    ok: input.length > 0,
    input,
    message: input
      ? 'Processed input for ${escapeSingleLine(opts.description)}.'
      : 'Provide input to continue.',
  });
}
`;
}

function toolTestTemplate(opts: NormalizedCodegenOptions, importPath: string): string {
  return `import { describe, expect, it } from 'vitest';
import { ${opts.constantName}_SCHEMA, ${opts.camelName}Tool } from '${importPath}';

describe('${opts.camelName}Tool', () => {
  it('exposes a function schema', () => {
    expect(${opts.constantName}_SCHEMA.function.name).toBe('${opts.toolId}');
  });

  it('returns a JSON payload', async () => {
    const response = await ${opts.camelName}Tool({ input: 'demo input' });
    const parsed = JSON.parse(response) as { ok: boolean; input: string };

    expect(parsed.ok).toBe(true);
    expect(parsed.input).toBe('demo input');
  });
});
`;
}

function utilTemplate(opts: NormalizedCodegenOptions): string {
  return `export function normalize${opts.pascalName}Input(value: string): string {
  return value.trim().replace(/\\s+/g, ' ');
}

export function format${opts.pascalName}Message(value: string): string {
  const normalized = normalize${opts.pascalName}Input(value);
  return normalized ? '${opts.pascalName} ready: ' + normalized : '${opts.pascalName} ready.';
}
`;
}

function utilTestTemplate(opts: NormalizedCodegenOptions, importPath: string): string {
  return `import { describe, expect, it } from 'vitest';
import { format${opts.pascalName}Message, normalize${opts.pascalName}Input } from '${importPath}';

describe('${opts.pascalName} util', () => {
  it('normalizes whitespace', () => {
    expect(normalize${opts.pascalName}Input('  many   spaces  ')).toBe('many spaces');
  });

  it('formats a readable message', () => {
    expect(format${opts.pascalName}Message('demo')).toContain('${opts.pascalName} ready: demo');
  });
});
`;
}

function classTemplate(opts: NormalizedCodegenOptions): string {
  return `export interface ${opts.pascalName}Options {
  name: string;
  description?: string;
}

export class ${opts.pascalName} {
  private name: string;
  private readonly description: string;

  constructor(options: ${opts.pascalName}Options) {
    this.name = options.name.trim();
    this.description = options.description?.trim() || '${escapeSingleLine(opts.description)}';
  }

  rename(nextName: string): void {
    const normalized = nextName.trim();
    if (normalized) this.name = normalized;
  }

  summary(): string {
    return \`\${this.name}: \${this.description}\`;
  }
}
`;
}

function classTestTemplate(opts: NormalizedCodegenOptions, importPath: string): string {
  return `import { describe, expect, it } from 'vitest';
import { ${opts.pascalName} } from '${importPath}';

describe('${opts.pascalName}', () => {
  it('builds a summary from constructor options', () => {
    const instance = new ${opts.pascalName}({ name: 'Demo' });

    expect(instance.summary()).toContain('Demo');
  });

  it('renames the instance', () => {
    const instance = new ${opts.pascalName}({ name: 'Old name' });
    instance.rename('New name');

    expect(instance.summary()).toContain('New name');
  });
});
`;
}

function toImportPath(fromFile: string, toFile: string): string {
  const fromDir = path.posix.dirname(fromFile);
  const relative = path.posix.relative(fromDir, toFile).replace(/\.(ts|js)$/u, '.js');
  return relative.startsWith('.') ? relative : `./${relative}`;
}

function toKebabCase(value: string): string {
  return value
    .replace(/([a-z0-9])([A-Z])/g, '$1-$2')
    .replace(/[^a-zA-Z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .toLowerCase();
}

function toCamelCase(value: string): string {
  return value.replace(/-([a-z0-9])/g, (_match, char: string) => char.toUpperCase());
}

function toPascalCase(value: string): string {
  const camel = toCamelCase(value);
  return camel.charAt(0).toUpperCase() + camel.slice(1);
}

function toConstantCase(value: string): string {
  return value.replace(/-/g, '_').toUpperCase();
}

function summarizeDescription(value: string, maxLength: number): string {
  const normalized = value.replace(/\s+/g, ' ').trim();
  if (normalized.length <= maxLength) return normalized;
  return `${normalized.slice(0, maxLength - 1).trimEnd()}…`;
}

function escapeSingleLine(value: string): string {
  return value.replace(/\s+/g, ' ').trim().replace(/'/g, "\\'");
}
