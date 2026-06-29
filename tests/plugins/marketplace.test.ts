import fs from 'node:fs/promises';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { Marketplace, pluginCommand, type Plugin } from '../../src/plugins/marketplace.js';

describe('Marketplace', () => {
  let tempRoot: string;
  let homeDir: string;
  let marketplace: Marketplace;
  let seedPlugins: Plugin[];

  beforeEach(async () => {
    tempRoot = path.join(process.cwd(), '.vitest-marketplace-tmp');
    await fs.mkdir(tempRoot, { recursive: true });
    homeDir = await fs.mkdtemp(path.join(tempRoot, 'case-'));
    seedPlugins = [
      {
        name: 'alpha-tools',
        version: '1.0.0',
        description: 'Alpha automation helpers.',
        author: 'Acme',
        installed: false,
      },
      {
        name: 'beta-lint',
        version: '2.1.0',
        description: 'Linting and formatting helpers.',
        author: 'Beta Labs',
        installed: false,
      },
    ];
    marketplace = new Marketplace({ homeDir, seedPlugins });
  });

  afterEach(async () => {
    await fs.rm(tempRoot, { recursive: true, force: true });
  });

  it('seeds and searches the registry', async () => {
    await expect(marketplace.list()).resolves.toEqual(seedPlugins);

    await expect(marketplace.search('lint')).resolves.toEqual([seedPlugins[1]]);
    await expect(marketplace.search('acme')).resolves.toEqual([seedPlugins[0]]);
  });

  it('installs and uninstalls a plugin', async () => {
    const installed = await marketplace.install('alpha-tools');

    expect(installed.installed).toBe(true);
    await expect(marketplace.getInfo('alpha-tools')).resolves.toMatchObject({ installed: true });

    const pluginFile = path.join(homeDir, '.icopilot', 'plugins', 'alpha-tools', 'plugin.json');
    await expect(readJson(pluginFile)).resolves.toMatchObject({
      name: 'alpha-tools',
      version: '1.0.0',
      installed: true,
    });

    const uninstalled = await marketplace.uninstall('alpha-tools');
    expect(uninstalled.installed).toBe(false);
    await expect(marketplace.getInfo('alpha-tools')).resolves.toMatchObject({ installed: false });
    await expect(fs.stat(pluginFile)).rejects.toMatchObject({ code: 'ENOENT' });
  });

  it('updates installed plugins from the registry', async () => {
    await marketplace.install('alpha-tools');
    const registryFile = path.join(homeDir, '.icopilot', 'plugin-registry.json');
    const registry = await readJson(registryFile);
    registry.plugins[0].version = '1.1.0';
    await fs.writeFile(registryFile, `${JSON.stringify(registry, null, 2)}\n`, 'utf8');

    const updated = await marketplace.update('alpha-tools');

    expect(updated).toEqual([
      expect.objectContaining({
        name: 'alpha-tools',
        version: '1.1.0',
        installed: true,
      }),
    ]);

    const pluginFile = path.join(homeDir, '.icopilot', 'plugins', 'alpha-tools', 'plugin.json');
    await expect(readJson(pluginFile)).resolves.toMatchObject({ version: '1.1.0' });
  });

  it('formats plugin slash command output', async () => {
    await marketplace.install('beta-lint');

    await expect(pluginCommand(['list'], marketplace)).resolves.toContain('beta-lint');
    await expect(pluginCommand(['search', 'beta'], marketplace)).resolves.toContain(
      'Plugin search',
    );
    await expect(pluginCommand(['info', 'beta-lint'], marketplace)).resolves.toContain(
      'installed:',
    );
    await expect(pluginCommand(['update'], marketplace)).resolves.toContain('Updated plugins');
  });
});

async function readJson(file: string): Promise<any> {
  return JSON.parse(await fs.readFile(file, 'utf8'));
}
