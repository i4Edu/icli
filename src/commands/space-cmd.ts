import { theme } from '../ui/theme.js';
import { serializeSpaceConfig } from '../spaces/space-config.js';
import { type Space, SpaceManager } from '../spaces/space.js';

export interface SpaceCommandOptions {
  cwd: string;
  onSwitch?: (space: Space) => void;
}

export function spaceCommand(args: string[], options: SpaceCommandOptions): string {
  const manager = new SpaceManager(() => options.cwd);
  const [subcommandRaw, ...rest] = args;
  const subcommand = (subcommandRaw || 'show').toLowerCase();

  try {
    switch (subcommand) {
      case 'show':
        return showSpace(manager, options.cwd);
      case 'list':
        return listSpaces(manager, options.cwd);
      case 'create':
        return createSpace(manager, rest[0], options);
      case 'switch':
        return switchSpace(manager, rest[0], options);
      case 'config':
        return showConfig(manager, options.cwd);
      case 'delete':
      case 'remove':
      case 'rm':
        return deleteSpace(manager, rest[0]);
      default:
        return usage();
    }
  } catch (error) {
    return theme.err(`space: ${(error as Error).message}\n`);
  }
}

function showSpace(manager: SpaceManager, cwd: string): string {
  const current = manager.currentSpace();
  if (!current) {
    return theme.dim(`No active space for ${cwd}.\n`);
  }

  const lines = [
    theme.brand('Current space'),
    `  name: ${theme.hl(current.name)}`,
    `  root: ${current.rootPath}`,
    `  branch: ${current.branch || theme.dim('none')}`,
    `  sessions: ${current.sessions.length}`,
  ];
  return `${lines.join('\n')}\n`;
}

function listSpaces(manager: SpaceManager, cwd: string): string {
  const spaces = manager.listSpaces();
  if (!spaces.length) return theme.dim('No spaces created.\n');

  const currentName = manager.currentSpace()?.name;
  const lines = spaces.map((space) => {
    const current = space.name === currentName || isCurrentCwd(cwd, space.rootPath);
    const marker = current ? theme.ok('*') : theme.dim('-');
    const branch = space.branch ? theme.dim(` (${space.branch})`) : '';
    return `  ${marker} ${theme.hl(space.name)} ${theme.dim('→')} ${space.rootPath}${branch}`;
  });
  return `${theme.brand('Spaces')}\n${lines.join('\n')}\n`;
}

function createSpace(
  manager: SpaceManager,
  name: string | undefined,
  options: SpaceCommandOptions,
): string {
  if (!name) return theme.warn('usage: /space create <name>\n');

  const space = manager.createSpace(name, options.cwd);
  manager.switchSpace(space.name);
  options.onSwitch?.(space);
  return theme.ok(`✔ created space ${space.name} ${theme.dim(`→ ${space.rootPath}`)}\n`);
}

function switchSpace(
  manager: SpaceManager,
  name: string | undefined,
  options: SpaceCommandOptions,
): string {
  if (!name) return theme.warn('usage: /space switch <name>\n');

  manager.switchSpace(name);
  const space = manager.loadSpace(name);
  options.onSwitch?.(space);
  return theme.ok(`✔ switched to space ${space.name} ${theme.dim(`→ ${space.rootPath}`)}\n`);
}

function showConfig(manager: SpaceManager, cwd: string): string {
  const current = manager.currentSpace();
  if (!current) return theme.warn(`no active space for ${cwd}\n`);

  return `${theme.brand('Space config')} ${theme.dim(current.name)}\n${serializeSpaceConfig(current.config)}`;
}

function deleteSpace(manager: SpaceManager, name: string | undefined): string {
  if (!name) return theme.warn('usage: /space delete <name>\n');
  manager.deleteSpace(name);
  return theme.ok(`✔ deleted space ${name}\n`);
}

function usage(): string {
  return theme.warn('usage: /space [list|create|switch|config|delete]\n');
}

function isCurrentCwd(cwd: string, rootPath: string): boolean {
  return cwd === rootPath || cwd.startsWith(`${rootPath}${rootPath.endsWith('\\') ? '' : '\\'}`);
}
