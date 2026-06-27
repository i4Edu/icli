import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { theme } from '../ui/theme.js';

export interface Extension {
  name: string;
  version: string;
  description: string;
  tools?: ExtensionTool[];
  commands?: ExtensionCommand[];
  path: string;
}

export interface ExtensionTool {
  name: string;
  description: string;
  parameters: Record<string, any>;
  handler: string;
}

export interface ExtensionCommand {
  name: string;
  description: string;
  handler: string;
}

export interface ExtensionManifest {
  name: string;
  version: string;
  description: string;
  tools?: Omit<ExtensionTool, 'handler'>[];
  commands?: Omit<ExtensionCommand, 'handler'>[];
}

const EXTENSIONS_DIR = path.join('.icopilot', 'extensions');
const HANDLER_FILE = 'index.js';

export function discoverExtensions(cwd: string): Extension[] {
  const userRoot = path.join(os.homedir(), EXTENSIONS_DIR);
  const projectRoot = path.join(cwd, EXTENSIONS_DIR);
  const discovered = new Map<string, Extension>();

  for (const root of [userRoot, projectRoot]) {
    for (const extension of discoverExtensionsInRoot(root)) {
      discovered.set(extension.name.toLowerCase(), extension);
    }
  }

  return [...discovered.values()].sort((a, b) => a.name.localeCompare(b.name));
}

export function loadExtensionManifest(extDir: string): ExtensionManifest | null {
  const manifestPath = path.join(extDir, 'manifest.json');
  try {
    const parsed = JSON.parse(fs.readFileSync(manifestPath, 'utf8')) as unknown;
    return isExtensionManifest(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

export function listExtensions(cwd: string): string {
  const extensions = discoverExtensions(cwd);
  if (extensions.length === 0) return theme.dim('No extensions discovered.\n');

  const lines = extensions.map((extension) => {
    const scope = extension.path.startsWith(path.join(cwd, '.icopilot'))
      ? theme.ok('project')
      : theme.dim('user');
    const toolCount = extension.tools?.length ?? 0;
    const commandCount = extension.commands?.length ?? 0;
    return `  ${theme.hl(extension.name)} ${theme.dim(`v${extension.version}`)} ${theme.dim(
      `(${scope})`,
    )} ${extension.description}${theme.dim(` [tools:${toolCount} commands:${commandCount}]`)}`;
  });

  return `${theme.brand('Extensions')}\n${lines.join('\n')}\n`;
}

export function extensionCommand(args: string[], cwd: string): string {
  const [subcommandRaw, ...rest] = args;
  const subcommand = (subcommandRaw || 'list').toLowerCase();

  switch (subcommand) {
    case 'list':
      return listExtensions(cwd);
    case 'info':
      return infoExtension(rest.join(' ').trim(), cwd);
    case 'reload': {
      const count = discoverExtensions(cwd).length;
      return theme.ok(`✔ reloaded ${count} extension${count === 1 ? '' : 's'}\n`);
    }
    default:
      return theme.warn('usage: /extension list|info <name>|reload\n');
  }
}

function infoExtension(name: string, cwd: string): string {
  if (!name) return theme.warn('usage: /extension info <name>\n');

  const extension = discoverExtensions(cwd).find(
    (candidate) => candidate.name.localeCompare(name, undefined, { sensitivity: 'accent' }) === 0,
  );
  if (!extension) return theme.warn(`extension not found: ${name}\n`);

  const lines = [
    `${theme.brand('Extension')} ${theme.hl(extension.name)} ${theme.dim(`v${extension.version}`)}`,
    `  ${extension.description}`,
    `  ${theme.dim('path:')} ${extension.path}`,
  ];

  if ((extension.tools?.length ?? 0) > 0) {
    lines.push(`  ${theme.ok('tools')}`);
    for (const tool of extension.tools ?? []) {
      lines.push(`    ${theme.hl(tool.name)} ${theme.dim('→')} ${tool.description}`);
    }
  }

  if ((extension.commands?.length ?? 0) > 0) {
    lines.push(`  ${theme.ok('commands')}`);
    for (const command of extension.commands ?? []) {
      lines.push(`    ${theme.hl(command.name)} ${theme.dim('→')} ${command.description}`);
    }
  }

  return `${lines.join('\n')}\n`;
}

function discoverExtensionsInRoot(root: string): Extension[] {
  if (!fs.existsSync(root)) return [];

  const entries = fs.readdirSync(root, { withFileTypes: true });
  const discovered: Extension[] = [];
  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    const extDir = path.join(root, entry.name);
    const manifest = loadExtensionManifest(extDir);
    if (!manifest) continue;
    discovered.push(extendManifest(extDir, manifest));
  }

  return discovered;
}

function extendManifest(extDir: string, manifest: ExtensionManifest): Extension {
  const handler = path.join(extDir, HANDLER_FILE);
  return {
    ...manifest,
    tools: manifest.tools?.map((tool) => ({ ...tool, handler })),
    commands: manifest.commands?.map((command) => ({ ...command, handler })),
    path: extDir,
  };
}

function isExtensionManifest(value: unknown): value is ExtensionManifest {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const manifest = value as Record<string, unknown>;

  return (
    isNonEmptyString(manifest.name) &&
    isNonEmptyString(manifest.version) &&
    isNonEmptyString(manifest.description) &&
    isToolManifestArray(manifest.tools) &&
    isCommandManifestArray(manifest.commands)
  );
}

function isToolManifestArray(value: unknown): value is ExtensionManifest['tools'] {
  if (value === undefined) return true;
  if (!Array.isArray(value)) return false;
  return value.every((tool) => {
    if (!tool || typeof tool !== 'object' || Array.isArray(tool)) return false;
    const entry = tool as Record<string, unknown>;
    return (
      isNonEmptyString(entry.name) &&
      isNonEmptyString(entry.description) &&
      isPlainObject(entry.parameters)
    );
  });
}

function isCommandManifestArray(value: unknown): value is ExtensionManifest['commands'] {
  if (value === undefined) return true;
  if (!Array.isArray(value)) return false;
  return value.every((command) => {
    if (!command || typeof command !== 'object' || Array.isArray(command)) return false;
    const entry = command as Record<string, unknown>;
    return isNonEmptyString(entry.name) && isNonEmptyString(entry.description);
  });
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0;
}

function isPlainObject(value: unknown): value is Record<string, any> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}
