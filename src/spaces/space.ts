import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { config } from '../config.js';
import { DEFAULT_SPACE_CONFIG, loadSpaceConfig, saveSpaceConfig } from './space-config.js';

export interface SpaceConfig {
  model?: string;
  systemPrompt?: string;
  tools?: string[];
  contextFiles?: string[];
  maxTokens?: number;
}

export interface Space {
  name: string;
  rootPath: string;
  branch?: string;
  config: SpaceConfig;
  sessions: string[];
}

const SPACES_ENV = 'ICOPILOT_SPACES_DIR';
const CURRENT_FILE = 'current.txt';

export class SpaceManager {
  constructor(
    private readonly cwdProvider: () => string = () => config.cwd,
    private readonly storeDir: string = spacesDir(),
  ) {}

  loadSpace(name: string): Space {
    const file = this.spaceFile(name);
    if (!fs.existsSync(file)) {
      throw new Error(`space not found: ${name}`);
    }

    const parsed = JSON.parse(fs.readFileSync(file, 'utf8')) as unknown;
    return normalizeSpace(parsed, name);
  }

  createSpace(name: string, rootPath: string): Space {
    const normalizedName = validateName(name);
    const normalizedRootPath = path.resolve(rootPath);
    const file = this.spaceFile(normalizedName);
    if (fs.existsSync(file)) {
      throw new Error(`space already exists: ${normalizedName}`);
    }
    if (!fs.existsSync(normalizedRootPath) || !fs.statSync(normalizedRootPath).isDirectory()) {
      throw new Error(`space root is not a directory: ${normalizedRootPath}`);
    }

    const space: Space = {
      name: normalizedName,
      rootPath: normalizedRootPath,
      branch: detectGitBranch(normalizedRootPath),
      config: loadSpaceConfig(normalizedRootPath),
      sessions: [],
    };

    fs.mkdirSync(this.storeDir, { recursive: true });
    saveSpaceConfig(normalizedRootPath, space.config);
    this.persistSpace(space);
    this.writeCurrentName(space.name);
    return space;
  }

  switchSpace(name: string): void {
    const space = this.loadSpace(name);
    this.writeCurrentName(space.name);
    config.cwd = space.rootPath;
  }

  listSpaces(): Space[] {
    if (!fs.existsSync(this.storeDir)) return [];
    return fs
      .readdirSync(this.storeDir)
      .filter((entry) => entry.endsWith('.json'))
      .map((entry) => {
        const file = path.join(this.storeDir, entry);
        try {
          const parsed = JSON.parse(fs.readFileSync(file, 'utf8')) as unknown;
          return normalizeSpace(parsed, decodeURIComponent(path.basename(entry, '.json')));
        } catch {
          return null;
        }
      })
      .filter((space): space is Space => space !== null)
      .sort((left, right) => left.name.localeCompare(right.name));
  }

  currentSpace(): Space | null {
    const detected = this.detectSpaceFromCwd(this.cwdProvider());
    if (detected) return detected;

    const name = this.readCurrentName();
    if (!name) return null;

    try {
      return this.loadSpace(name);
    } catch {
      return null;
    }
  }

  deleteSpace(name: string): void {
    const normalizedName = validateName(name);
    const file = this.spaceFile(normalizedName);
    if (!fs.existsSync(file)) {
      throw new Error(`space not found: ${normalizedName}`);
    }

    fs.rmSync(file, { force: true });
    if (this.readCurrentName() === normalizedName) {
      const currentFile = this.currentFile();
      if (fs.existsSync(currentFile)) fs.rmSync(currentFile, { force: true });
    }
  }

  private detectSpaceFromCwd(cwd: string): Space | null {
    const normalizedCwd = path.resolve(cwd);
    const matches = this.listSpaces().filter((space) =>
      isWithinRoot(normalizedCwd, space.rootPath),
    );
    if (!matches.length) return null;
    return matches.sort((left, right) => right.rootPath.length - left.rootPath.length)[0] ?? null;
  }

  private persistSpace(space: Space): void {
    fs.mkdirSync(this.storeDir, { recursive: true });
    fs.writeFileSync(this.spaceFile(space.name), `${JSON.stringify(space, null, 2)}\n`, 'utf8');
  }

  private spaceFile(name: string): string {
    return path.join(this.storeDir, `${encodeURIComponent(validateName(name))}.json`);
  }

  private currentFile(): string {
    return path.join(this.storeDir, CURRENT_FILE);
  }

  private readCurrentName(): string | null {
    const file = this.currentFile();
    if (!fs.existsSync(file)) return null;
    const name = fs.readFileSync(file, 'utf8').trim();
    return name || null;
  }

  private writeCurrentName(name: string): void {
    fs.mkdirSync(this.storeDir, { recursive: true });
    fs.writeFileSync(this.currentFile(), `${name}\n`, 'utf8');
  }
}

export function spacesDir(): string {
  return process.env[SPACES_ENV] || path.join(os.homedir(), '.icopilot', 'spaces');
}

function validateName(name: string): string {
  const trimmed = name.trim();
  if (!trimmed) {
    throw new Error('space name is required');
  }
  return trimmed;
}

function normalizeSpace(raw: unknown, fallbackName?: string): Space {
  if (!raw || typeof raw !== 'object') {
    throw new Error(`invalid space definition: ${fallbackName ?? 'unknown'}`);
  }

  const record = raw as Record<string, unknown>;
  const name =
    typeof record.name === 'string' && record.name.trim() ? record.name.trim() : fallbackName;
  const rootPath = typeof record.rootPath === 'string' ? path.resolve(record.rootPath) : '';
  if (!name || !rootPath) {
    throw new Error(`invalid space definition: ${fallbackName ?? 'unknown'}`);
  }

  const savedConfig = readConfig(record.config);
  const fileConfig = loadSpaceConfig(rootPath);
  return {
    name,
    rootPath,
    branch:
      typeof record.branch === 'string' && record.branch.trim()
        ? record.branch
        : detectGitBranch(rootPath),
    config: {
      model: fileConfig.model ?? savedConfig.model,
      systemPrompt: fileConfig.systemPrompt ?? savedConfig.systemPrompt,
      tools: fileConfig.tools ?? savedConfig.tools,
      contextFiles: fileConfig.contextFiles ?? savedConfig.contextFiles,
      maxTokens: fileConfig.maxTokens ?? savedConfig.maxTokens,
    },
    sessions: Array.isArray(record.sessions)
      ? record.sessions.filter((value): value is string => typeof value === 'string')
      : [],
  };
}

function readConfig(raw: unknown): SpaceConfig {
  if (!raw || typeof raw !== 'object') {
    return {
      ...DEFAULT_SPACE_CONFIG,
      tools: [...(DEFAULT_SPACE_CONFIG.tools ?? [])],
      contextFiles: [...(DEFAULT_SPACE_CONFIG.contextFiles ?? [])],
    };
  }

  const record = raw as Record<string, unknown>;
  return {
    model: typeof record.model === 'string' ? record.model : undefined,
    systemPrompt: typeof record.systemPrompt === 'string' ? record.systemPrompt : undefined,
    tools: Array.isArray(record.tools)
      ? record.tools.filter((value): value is string => typeof value === 'string')
      : [],
    contextFiles: Array.isArray(record.contextFiles)
      ? record.contextFiles.filter((value): value is string => typeof value === 'string')
      : [],
    maxTokens: typeof record.maxTokens === 'number' ? record.maxTokens : undefined,
  };
}

function isWithinRoot(cwd: string, rootPath: string): boolean {
  const relative = path.relative(rootPath, cwd);
  return relative === '' || (!relative.startsWith('..') && !path.isAbsolute(relative));
}

function detectGitBranch(rootPath: string): string | undefined {
  const gitDir = resolveGitDir(rootPath);
  if (!gitDir) return undefined;

  try {
    const head = fs.readFileSync(path.join(gitDir, 'HEAD'), 'utf8').trim();
    const match = /^ref:\s+refs\/heads\/(.+)$/.exec(head);
    return match?.[1];
  } catch {
    return undefined;
  }
}

function resolveGitDir(rootPath: string): string | null {
  const gitPath = path.join(rootPath, '.git');
  if (!fs.existsSync(gitPath)) return null;
  if (fs.statSync(gitPath).isDirectory()) return gitPath;

  try {
    const content = fs.readFileSync(gitPath, 'utf8').trim();
    const match = /^gitdir:\s+(.+)$/i.exec(content);
    if (!match) return null;
    return path.resolve(rootPath, match[1].trim());
  } catch {
    return null;
  }
}
