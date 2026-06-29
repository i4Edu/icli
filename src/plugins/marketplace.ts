import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { theme } from '../ui/theme.js';

export interface Plugin {
  name: string;
  version: string;
  description: string;
  author: string;
  installed: boolean;
}

interface MarketplaceOptions {
  homeDir?: string;
  registryFile?: string;
  pluginsDir?: string;
  seedPlugins?: Plugin[];
}

interface RegistryShape {
  plugins: Plugin[];
}

const DEFAULT_PLUGINS: Plugin[] = [
  {
    name: 'azure-tools',
    version: '1.2.0',
    description: 'Azure deployment helpers, diagnostics, and workflow shortcuts.',
    author: 'iCopilot',
    installed: false,
  },
  {
    name: 'jira-sync',
    version: '0.8.1',
    description: 'Create and update Jira issues from terminal workflows.',
    author: 'iCopilot',
    installed: false,
  },
  {
    name: 'shell-utils',
    version: '2.0.3',
    description: 'Reusable shell helpers for scripts, prompts, and environment checks.',
    author: 'iCopilot',
    installed: false,
  },
];

export class Marketplace {
  private readonly registryFile: string;
  private readonly pluginsDir: string;
  private readonly seedPlugins: Plugin[];

  constructor(options: MarketplaceOptions = {}) {
    const homeDir = options.homeDir ?? os.homedir();
    this.registryFile =
      options.registryFile ?? path.join(homeDir, '.icopilot', 'plugin-registry.json');
    this.pluginsDir = options.pluginsDir ?? path.join(homeDir, '.icopilot', 'plugins');
    this.seedPlugins = dedupePlugins(options.seedPlugins ?? DEFAULT_PLUGINS);
  }

  async search(query: string): Promise<Plugin[]> {
    const normalizedQuery = query.trim().toLowerCase();
    const plugins = await this.list();
    if (!normalizedQuery) return plugins;

    return plugins.filter((plugin) =>
      [plugin.name, plugin.version, plugin.description, plugin.author]
        .join('\n')
        .toLowerCase()
        .includes(normalizedQuery),
    );
  }

  async install(name: string): Promise<Plugin> {
    const registry = await this.readRegistry();
    const plugin = findPlugin(registry.plugins, name);
    if (!plugin) {
      throw new Error(`plugin not found: ${name}`);
    }

    plugin.installed = true;
    await this.writeRegistry(registry);
    await this.writeInstalledPlugin(plugin);
    return { ...plugin };
  }

  async uninstall(name: string): Promise<Plugin> {
    const registry = await this.readRegistry();
    const plugin = findPlugin(registry.plugins, name);
    if (!plugin) {
      throw new Error(`plugin not found: ${name}`);
    }

    plugin.installed = false;
    await this.writeRegistry(registry);
    await fs.rm(this.pluginDir(plugin.name), { recursive: true, force: true });
    return { ...plugin };
  }

  async update(name?: string): Promise<Plugin[]> {
    const registry = await this.readRegistry();
    const candidates = name
      ? [findPlugin(registry.plugins, name)].filter((plugin): plugin is Plugin => Boolean(plugin))
      : registry.plugins.filter((plugin) => plugin.installed);

    if (name && candidates.length === 0) {
      throw new Error(`plugin not found: ${name}`);
    }

    const notInstalled = candidates.find((plugin) => !plugin.installed);
    if (notInstalled) {
      throw new Error(`plugin is not installed: ${notInstalled.name}`);
    }

    for (const plugin of candidates) {
      await this.writeInstalledPlugin(plugin);
    }

    if (candidates.length > 0) {
      await this.writeRegistry(registry);
    }

    return candidates.map((plugin) => ({ ...plugin }));
  }

  async list(): Promise<Plugin[]> {
    const registry = await this.readRegistry();
    return registry.plugins.map((plugin) => ({ ...plugin }));
  }

  async getInfo(name: string): Promise<Plugin | null> {
    const registry = await this.readRegistry();
    const plugin = findPlugin(registry.plugins, name);
    return plugin ? { ...plugin } : null;
  }

  private async readRegistry(): Promise<RegistryShape> {
    await fs.mkdir(path.dirname(this.registryFile), { recursive: true });

    try {
      const raw = await fs.readFile(this.registryFile, 'utf8');
      const parsed = JSON.parse(raw) as unknown;
      const plugins = mergeWithSeed(parseRegistryPlugins(parsed), this.seedPlugins);
      const registry = { plugins };
      await this.writeRegistry(registry);
      return registry;
    } catch (error: any) {
      if (error?.code !== 'ENOENT') throw error;
      const registry = { plugins: this.seedPlugins.map((plugin) => ({ ...plugin })) };
      await this.writeRegistry(registry);
      return registry;
    }
  }

  private async writeRegistry(registry: RegistryShape): Promise<void> {
    await fs.mkdir(path.dirname(this.registryFile), { recursive: true });
    await fs.writeFile(
      this.registryFile,
      `${JSON.stringify({ plugins: dedupePlugins(registry.plugins) }, null, 2)}\n`,
      'utf8',
    );
  }

  private async writeInstalledPlugin(plugin: Plugin): Promise<void> {
    const dir = this.pluginDir(plugin.name);
    await fs.mkdir(dir, { recursive: true });
    await fs.writeFile(
      path.join(dir, 'plugin.json'),
      `${JSON.stringify(plugin, null, 2)}\n`,
      'utf8',
    );
  }

  private pluginDir(name: string): string {
    return path.join(this.pluginsDir, name);
  }
}

export async function pluginCommand(
  args: string[],
  marketplace = new Marketplace(),
): Promise<string> {
  const [subcommandRaw, ...rest] = args;
  const subcommand = (subcommandRaw || 'list').toLowerCase();

  switch (subcommand) {
    case 'search': {
      const query = rest.join(' ').trim();
      if (!query) return theme.warn('usage: /plugin search <query>\n');
      return formatPluginList(`Plugin search ${theme.dim(query)}`, await marketplace.search(query));
    }
    case 'install': {
      const name = rest.join(' ').trim();
      if (!name) return theme.warn('usage: /plugin install <name>\n');
      const plugin = await marketplace.install(name);
      return theme.ok(`✔ installed ${plugin.name} ${theme.dim(`v${plugin.version}`)}\n`);
    }
    case 'uninstall': {
      const name = rest.join(' ').trim();
      if (!name) return theme.warn('usage: /plugin uninstall <name>\n');
      const plugin = await marketplace.uninstall(name);
      return theme.ok(`✔ uninstalled ${plugin.name} ${theme.dim(`v${plugin.version}`)}\n`);
    }
    case 'update': {
      const name = rest.join(' ').trim();
      const updated = await marketplace.update(name || undefined);
      if (updated.length === 0) return theme.dim('No installed plugins to update.\n');
      const scope = name ? `Updated ${updated[0]!.name}` : 'Updated plugins';
      return formatPluginList(scope, updated);
    }
    case 'list':
      return formatPluginList('Plugins', await marketplace.list());
    case 'info': {
      const name = rest.join(' ').trim();
      if (!name) return theme.warn('usage: /plugin info <name>\n');
      const plugin = await marketplace.getInfo(name);
      if (!plugin) return theme.warn(`plugin not found: ${name}\n`);
      return formatPluginDetails(plugin);
    }
    default:
      return theme.warn(
        'usage: /plugin list|search <query>|install <name>|uninstall <name>|update [name]|info <name>\n',
      );
  }
}

function formatPluginList(title: string, plugins: Plugin[]): string {
  if (plugins.length === 0) return `${theme.brand(title)}\n${theme.dim('  no plugins found')}\n`;
  const lines = plugins.map(
    (plugin) =>
      `  ${theme.hl(plugin.name)} ${theme.dim(`v${plugin.version}`)} ${plugin.description} ${theme.dim(
        `(${plugin.author})`,
      )}${plugin.installed ? ` ${theme.ok('[installed]')}` : ''}`,
  );
  return `${theme.brand(title)}\n${lines.join('\n')}\n`;
}

function formatPluginDetails(plugin: Plugin): string {
  return [
    `${theme.brand('Plugin')} ${theme.hl(plugin.name)} ${theme.dim(`v${plugin.version}`)}`,
    `  ${plugin.description}`,
    `  ${theme.dim('author:')} ${plugin.author}`,
    `  ${theme.dim('installed:')} ${plugin.installed ? 'yes' : 'no'}`,
    '',
  ].join('\n');
}

function mergeWithSeed(plugins: Plugin[], seedPlugins: Plugin[]): Plugin[] {
  const merged = new Map<string, Plugin>();

  for (const plugin of seedPlugins) {
    merged.set(plugin.name.toLowerCase(), { ...plugin });
  }

  for (const plugin of plugins) {
    const key = plugin.name.toLowerCase();
    const base = merged.get(key);
    merged.set(key, { ...(base ?? {}), ...plugin, installed: plugin.installed });
  }

  return [...merged.values()].sort((a, b) => a.name.localeCompare(b.name));
}

function parseRegistryPlugins(value: unknown): Plugin[] {
  const rawPlugins = Array.isArray(value)
    ? value
    : value &&
        typeof value === 'object' &&
        Array.isArray((value as { plugins?: unknown[] }).plugins)
      ? (value as { plugins: unknown[] }).plugins
      : [];

  return dedupePlugins(rawPlugins.filter(isPlugin));
}

function dedupePlugins(plugins: Plugin[]): Plugin[] {
  const deduped = new Map<string, Plugin>();
  for (const plugin of plugins) {
    deduped.set(plugin.name.toLowerCase(), normalizePlugin(plugin));
  }
  return [...deduped.values()].sort((a, b) => a.name.localeCompare(b.name));
}

function normalizePlugin(plugin: Plugin): Plugin {
  return {
    name: plugin.name.trim(),
    version: plugin.version.trim(),
    description: plugin.description.trim(),
    author: plugin.author.trim(),
    installed: Boolean(plugin.installed),
  };
}

function findPlugin(plugins: Plugin[], name: string): Plugin | undefined {
  const normalizedName = name.trim().toLowerCase();
  return plugins.find((plugin) => plugin.name.toLowerCase() === normalizedName);
}

function isPlugin(value: unknown): value is Plugin {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const plugin = value as Record<string, unknown>;
  return (
    typeof plugin.name === 'string' &&
    typeof plugin.version === 'string' &&
    typeof plugin.description === 'string' &&
    typeof plugin.author === 'string' &&
    typeof plugin.installed === 'boolean'
  );
}
