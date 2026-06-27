import fs from 'node:fs';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { spaceCommand } from '../../src/commands/space-cmd.js';
import { config } from '../../src/config.js';
import {
  DEFAULT_SPACE_CONFIG,
  DEFAULT_SPACE_CONFIG_TEMPLATE,
  loadSpaceConfig,
  saveSpaceConfig,
  serializeSpaceConfig,
} from '../../src/spaces/space-config.js';
import { SpaceManager } from '../../src/spaces/space.js';

let testRoot = '';
let spacesStore = '';
let originalCwd = '';
let originalSpacesDir = '';

describe('spaces', () => {
  beforeEach(() => {
    originalCwd = config.cwd;
    originalSpacesDir = process.env.ICOPILOT_SPACES_DIR || '';
    testRoot = path.join(
      process.cwd(),
      '.test-artifacts',
      'spaces',
      `${Date.now()}-${Math.random().toString(16).slice(2)}`,
    );
    spacesStore = path.join(testRoot, 'home', '.icopilot', 'spaces');
    fs.mkdirSync(spacesStore, { recursive: true });
    process.env.ICOPILOT_SPACES_DIR = spacesStore;
  });

  afterEach(() => {
    config.cwd = originalCwd;
    if (originalSpacesDir) {
      process.env.ICOPILOT_SPACES_DIR = originalSpacesDir;
    } else {
      delete process.env.ICOPILOT_SPACES_DIR;
    }
    fs.rmSync(testRoot, { recursive: true, force: true });
    vi.restoreAllMocks();
  });

  it('loads defaults and round-trips space config yaml', () => {
    const root = createWorkspace('config-project');

    expect(loadSpaceConfig(root)).toEqual(DEFAULT_SPACE_CONFIG);
    expect(DEFAULT_SPACE_CONFIG_TEMPLATE).toContain('tools: []');

    saveSpaceConfig(root, {
      model: 'gpt-4o-mini',
      systemPrompt: 'Stay focused',
      tools: ['shell', 'search'],
      contextFiles: ['README.md', 'src/index.ts'],
      maxTokens: 4096,
    });

    expect(loadSpaceConfig(root)).toEqual({
      model: 'gpt-4o-mini',
      systemPrompt: 'Stay focused',
      tools: ['shell', 'search'],
      contextFiles: ['README.md', 'src/index.ts'],
      maxTokens: 4096,
    });
    expect(serializeSpaceConfig(loadSpaceConfig(root))).toContain('"shell"');
  });

  it('creates, loads, lists, switches, and auto-detects spaces from cwd', () => {
    const projectRoot = createWorkspace('project-alpha');
    writeGitBranch(projectRoot, 'feature/alpha');
    const nestedRoot = path.join(projectRoot, 'packages', 'app');
    fs.mkdirSync(nestedRoot, { recursive: true });

    const manager = new SpaceManager(() => path.join(projectRoot, 'src'), spacesStore);
    const alpha = manager.createSpace('alpha', projectRoot);
    manager.createSpace('app', nestedRoot);

    expect(alpha.branch).toBe('feature/alpha');
    expect(manager.loadSpace('alpha').rootPath).toBe(projectRoot);
    expect(manager.listSpaces().map((space) => space.name)).toEqual(['alpha', 'app']);
    expect(manager.currentSpace()?.name).toBe('alpha');

    const nestedManager = new SpaceManager(() => path.join(nestedRoot, 'src'), spacesStore);
    expect(nestedManager.currentSpace()?.name).toBe('app');

    config.cwd = projectRoot;
    manager.switchSpace('app');
    expect(config.cwd).toBe(nestedRoot);

    manager.deleteSpace('app');
    expect(manager.listSpaces().map((space) => space.name)).toEqual(['alpha']);
  });

  it('handles /space commands', () => {
    const alphaRoot = createWorkspace('cmd-alpha');
    const betaRoot = createWorkspace('cmd-beta');
    writeGitBranch(alphaRoot, 'main');
    writeGitBranch(betaRoot, 'release');

    const switchedTo: string[] = [];
    const created = spaceCommand(['create', 'alpha'], {
      cwd: alphaRoot,
      onSwitch: (space) => switchedTo.push(space.rootPath),
    });
    expect(created).toContain('created space alpha');

    const current = spaceCommand([], { cwd: alphaRoot });
    expect(current).toContain('Current space');
    expect(current).toContain('alpha');

    const configOutput = spaceCommand(['config'], { cwd: alphaRoot });
    expect(configOutput).toContain('Space config');
    expect(configOutput).toContain('tools: []');

    const manager = new SpaceManager(() => betaRoot, spacesStore);
    manager.createSpace('beta', betaRoot);

    const list = spaceCommand(['list'], { cwd: alphaRoot });
    expect(list).toContain('alpha');
    expect(list).toContain('beta');

    const switched = spaceCommand(['switch', 'beta'], {
      cwd: alphaRoot,
      onSwitch: (space) => switchedTo.push(space.rootPath),
    });
    expect(switched).toContain('switched to space beta');
    expect(switchedTo).toContain(alphaRoot);
    expect(switchedTo).toContain(betaRoot);

    const deleted = spaceCommand(['delete', 'beta'], { cwd: alphaRoot });
    expect(deleted).toContain('deleted space beta');
  });
});

function createWorkspace(name: string): string {
  const dir = path.join(testRoot, name);
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

function writeGitBranch(rootPath: string, branch: string): void {
  const gitDir = path.join(rootPath, '.git');
  fs.mkdirSync(gitDir, { recursive: true });
  fs.writeFileSync(path.join(gitDir, 'HEAD'), `ref: refs/heads/${branch}\n`, 'utf8');
}
