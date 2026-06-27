import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  discoverExtensions,
  extensionCommand,
  listExtensions,
  loadExtensionManifest,
} from '../../src/extensions/loader.js';

let rootDir: string;
let cwd: string;
let homeDir: string;
let homedirSpy: ReturnType<typeof vi.spyOn>;

beforeEach(() => {
  rootDir = fs.mkdtempSync(path.join(os.tmpdir(), 'icli-extensions-'));
  cwd = path.join(rootDir, 'project');
  homeDir = path.join(rootDir, 'home');
  fs.mkdirSync(cwd, { recursive: true });
  fs.mkdirSync(homeDir, { recursive: true });
  homedirSpy = vi.spyOn(os, 'homedir').mockReturnValue(homeDir);
});

afterEach(() => {
  homedirSpy.mockRestore();
  fs.rmSync(rootDir, { recursive: true, force: true });
});

describe('extensions loader', () => {
  it('loads a valid manifest and rejects invalid manifests', () => {
    const validDir = writeExtension(path.join(cwd, '.icopilot', 'extensions'), 'project-tool', {
      name: 'project-tool',
      version: '1.0.0',
      description: 'Project extension',
      tools: [{ name: 'echo', description: 'Echoes text', parameters: { text: { type: 'string' } } }],
    });
    const invalidDir = writeExtension(path.join(cwd, '.icopilot', 'extensions'), 'broken', {
      name: 'broken',
      version: 1,
      description: 'Broken extension',
    });

    expect(loadExtensionManifest(validDir)).toMatchObject({
      name: 'project-tool',
      version: '1.0.0',
    });
    expect(loadExtensionManifest(invalidDir)).toBeNull();
  });

  it('discovers user and project extensions and prefers project-scoped duplicates', () => {
    writeExtension(path.join(homeDir, '.icopilot', 'extensions'), 'shared', {
      name: 'shared',
      version: '0.1.0',
      description: 'User shared extension',
      commands: [{ name: 'user-shared', description: 'User command' }],
    });
    writeExtension(path.join(cwd, '.icopilot', 'extensions'), 'shared', {
      name: 'shared',
      version: '0.2.0',
      description: 'Project shared extension',
      commands: [{ name: 'project-shared', description: 'Project command' }],
    });
    writeExtension(path.join(cwd, '.icopilot', 'extensions'), 'project-only', {
      name: 'project-only',
      version: '1.2.3',
      description: 'Project-only extension',
      tools: [{ name: 'project-tool', description: 'Project tool', parameters: {} }],
    });

    const extensions = discoverExtensions(cwd);

    expect(extensions).toHaveLength(2);
    expect(extensions.map((extension) => extension.name)).toEqual(['project-only', 'shared']);
    expect(extensions.find((extension) => extension.name === 'shared')).toMatchObject({
      version: '0.2.0',
      description: 'Project shared extension',
      commands: [
        {
          name: 'project-shared',
          handler: path.join(cwd, '.icopilot', 'extensions', 'shared', 'index.js'),
        },
      ],
    });
  });

  it('formats extension listings and slash subcommands', () => {
    writeExtension(path.join(homeDir, '.icopilot', 'extensions'), 'notes', {
      name: 'notes',
      version: '1.0.0',
      description: 'Notes integration',
      tools: [{ name: 'capture-note', description: 'Capture a note', parameters: {} }],
      commands: [{ name: 'notes-sync', description: 'Sync notes' }],
    });

    const listing = listExtensions(cwd);
    expect(listing).toContain('Extensions');
    expect(listing).toContain('notes');
    expect(listing).toContain('Notes integration');

    const info = extensionCommand(['info', 'notes'], cwd);
    expect(info).toContain('Extension');
    expect(info).toContain('capture-note');
    expect(info).toContain('notes-sync');

    const reload = extensionCommand(['reload'], cwd);
    expect(reload).toContain('reloaded 1 extension');
  });
});

function writeExtension(
  baseDir: string,
  folderName: string,
  manifest: Record<string, unknown>,
): string {
  const extDir = path.join(baseDir, folderName);
  fs.mkdirSync(extDir, { recursive: true });
  fs.writeFileSync(path.join(extDir, 'manifest.json'), `${JSON.stringify(manifest, null, 2)}\n`, 'utf8');
  return extDir;
}
