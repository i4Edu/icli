import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { theme } from '../ui/theme.js';

export interface Skill {
  name: string;
  description: string;
  source: 'file' | 'url' | 'directory';
  path: string;
  active: boolean;
}

export interface SkillStore {
  skills: Skill[];
  configPath: string;
}

const SKILLS_ENV = 'ICOPILOT_SKILLS_PATH';

const SKILL_USAGE = [
  theme.brand('Skill command'),
  `  ${theme.hl('/skill list')}                 ${theme.dim('show saved skills')}`,
  `  ${theme.hl('/skill add <path-or-url>')}    ${theme.dim('add a skill from a file, directory, or URL')}`,
  `  ${theme.hl('/skill remove <name>')}        ${theme.dim('remove a skill')}`,
  `  ${theme.hl('/skill activate <name>')}      ${theme.dim('activate a skill')}`,
  `  ${theme.hl('/skill deactivate <name>')}    ${theme.dim('deactivate a skill')}`,
].join('\n');

export function loadSkills(): Skill[] {
  return loadSkillStore().skills;
}

export function saveSkills(skills: Skill[]): void {
  const store = loadSkillStore();
  const next: SkillStore = {
    configPath: store.configPath,
    skills: [...skills].filter(isSkill).sort((left, right) => left.name.localeCompare(right.name)),
  };

  fs.mkdirSync(path.dirname(next.configPath), { recursive: true });
  fs.writeFileSync(next.configPath, `${JSON.stringify(next, null, 2)}\n`, 'utf8');
}

export function addSkill(source: string): Skill | { error: string } {
  const raw = source.trim();
  if (!raw) return { error: 'usage: /skill add <path-or-url>' };

  try {
    const current = loadSkills();
    const resolved = resolveSkillSource(raw);
    const content = readResolvedSourceContent(resolved);
    const name = uniqueSkillName(skillNameFromSource(resolved.path), current);
    const duplicate = current.find(
      (skill) =>
        skill.path === resolved.path ||
        skill.name.localeCompare(name, undefined, { sensitivity: 'accent' }) === 0,
    );

    if (duplicate) {
      return { error: `skill already exists: ${duplicate.name}` };
    }

    const skill: Skill = {
      name,
      description: skillDescriptionFromContent(content, resolved),
      source: resolved.source,
      path: resolved.path,
      active: true,
    };

    saveSkills([...current, skill]);
    return skill;
  } catch (error) {
    return { error: (error as Error).message };
  }
}

export function removeSkill(name: string): boolean {
  const target = name.trim();
  if (!target) return false;

  const current = loadSkills();
  const next = current.filter(
    (skill) => skill.name.localeCompare(target, undefined, { sensitivity: 'accent' }) !== 0,
  );
  if (next.length === current.length) return false;

  saveSkills(next);
  return true;
}

export function listSkills(): string {
  const skills = loadSkills();
  if (skills.length === 0) return theme.dim('No skills saved.\n');

  const lines = skills.map((skill) => {
    const status = skill.active ? theme.ok('active') : theme.dim('inactive');
    return `  ${theme.hl(skill.name)}  [${status}]  ${theme.dim(skill.source)}  ${theme.dim('—')} ${skill.description}`;
  });
  return `${theme.brand('Skills')}\n${lines.join('\n')}\n`;
}

export function activateSkill(name: string): boolean {
  return setSkillActiveState(name, true);
}

export function deactivateSkill(name: string): boolean {
  return setSkillActiveState(name, false);
}

export function getActiveSkillContext(): string {
  const active = loadSkills().filter((skill) => skill.active);
  if (active.length === 0) return '';

  const sections: string[] = [];
  for (const skill of active) {
    try {
      const content = readSkillContent(skill).trim();
      if (!content) continue;
      sections.push(`## Skill: ${skill.name}\n${content}`);
    } catch {
      continue;
    }
  }

  return sections.join('\n\n');
}

export function skillCommand(args: string[]): string {
  const [subcommandRaw, ...rest] = args;
  const subcommand = (subcommandRaw || '').toLowerCase();

  switch (subcommand) {
    case '':
      return `${SKILL_USAGE}\n`;
    case 'list':
      return listSkills();
    case 'add': {
      const source = rest.join(' ').trim();
      if (!source) return theme.warn('usage: /skill add <path-or-url>\n');

      const result = addSkill(source);
      if ('error' in result) return theme.err(`skill: ${result.error}\n`);
      return theme.ok(`✔ added skill ${result.name} (${result.source})\n`);
    }
    case 'remove':
    case 'delete':
    case 'rm': {
      const [name] = rest;
      if (!name) return theme.warn('usage: /skill remove <name>\n');
      return removeSkill(name)
        ? theme.ok(`✔ removed skill ${name}\n`)
        : theme.warn(`skill not found: ${name}\n`);
    }
    case 'activate': {
      const [name] = rest;
      if (!name) return theme.warn('usage: /skill activate <name>\n');
      return activateSkill(name)
        ? theme.ok(`✔ activated skill ${name}\n`)
        : theme.warn(`skill not found: ${name}\n`);
    }
    case 'deactivate': {
      const [name] = rest;
      if (!name) return theme.warn('usage: /skill deactivate <name>\n');
      return deactivateSkill(name)
        ? theme.ok(`✔ deactivated skill ${name}\n`)
        : theme.warn(`skill not found: ${name}\n`);
    }
    default:
      return theme.warn('usage: /skill [list|add|remove|activate|deactivate]\n');
  }
}

function loadSkillStore(): SkillStore {
  const configPath = skillsPath();
  if (!fs.existsSync(configPath)) {
    return { skills: [], configPath };
  }

  try {
    const parsed = JSON.parse(fs.readFileSync(configPath, 'utf8')) as unknown;
    if (Array.isArray(parsed)) {
      return {
        skills: parsed.filter(isSkill).sort((left, right) => left.name.localeCompare(right.name)),
        configPath,
      };
    }

    if (
      parsed &&
      typeof parsed === 'object' &&
      Array.isArray((parsed as { skills?: unknown }).skills)
    ) {
      return {
        skills: (parsed as { skills: unknown[] }).skills
          .filter(isSkill)
          .sort((left, right) => left.name.localeCompare(right.name)),
        configPath,
      };
    }
  } catch {
    return { skills: [], configPath };
  }

  return { skills: [], configPath };
}

function skillsPath(): string {
  return process.env[SKILLS_ENV] || path.join(os.homedir(), '.icopilot', 'skills.json');
}

function setSkillActiveState(name: string, active: boolean): boolean {
  const target = name.trim();
  if (!target) return false;

  const current = loadSkills();
  let changed = false;
  const next = current.map((skill) => {
    if (skill.name.localeCompare(target, undefined, { sensitivity: 'accent' }) !== 0) return skill;
    changed = true;
    return { ...skill, active };
  });

  if (!changed) return false;
  saveSkills(next);
  return true;
}

function resolveSkillSource(source: string): SkillSource {
  if (isLikelyUrl(source)) {
    return { source: 'url', path: normalizeUrl(source) };
  }

  const resolvedPath = path.resolve(source);
  if (!fs.existsSync(resolvedPath)) {
    throw new Error(`skill source not found: ${source}`);
  }

  const stats = fs.statSync(resolvedPath);
  if (stats.isDirectory()) return { source: 'directory', path: resolvedPath };
  if (stats.isFile()) return { source: 'file', path: resolvedPath };
  throw new Error(`unsupported skill source: ${source}`);
}

function normalizeUrl(source: string): string {
  const url = new URL(source);
  if (url.protocol === 'http:' || url.protocol === 'https:' || url.protocol === 'file:') {
    return url.toString();
  }
  throw new Error(`unsupported URL protocol: ${url.protocol}`);
}

function isLikelyUrl(source: string): boolean {
  if (/^[a-zA-Z]:[\\/]/.test(source) || source.startsWith('\\\\')) {
    return false;
  }

  try {
    const url = new URL(source);
    return url.protocol === 'http:' || url.protocol === 'https:' || url.protocol === 'file:';
  } catch {
    return false;
  }
}

function readSkillContent(skill: Skill): string {
  return readResolvedSourceContent({ source: skill.source, path: skill.path });
}

function readResolvedSourceContent(source: SkillSource): string {
  switch (source.source) {
    case 'file':
      return readTextFile(source.path);
    case 'directory':
      return readDirectory(source.path);
    case 'url':
      return readUrl(source.path);
  }
}

function readUrl(urlValue: string): string {
  const url = new URL(urlValue);
  if (url.protocol === 'file:') {
    return readTextFile(fileURLToPath(url));
  }

  return execFileSync('curl', ['-fsSL', urlValue], {
    encoding: 'utf8',
    maxBuffer: 10 * 1024 * 1024,
  }).trim();
}

function readDirectory(dirPath: string): string {
  const files = listFilesRecursively(dirPath);
  const sections = files
    .map((filePath) => {
      const content = readTextFile(filePath).trim();
      if (!content) return null;
      const relative = path.relative(dirPath, filePath) || path.basename(filePath);
      return `### File: ${relative}\n${content}`;
    })
    .filter((section): section is string => Boolean(section));

  return sections.join('\n\n');
}

function listFilesRecursively(dirPath: string): string[] {
  const files: string[] = [];
  const entries = fs.readdirSync(dirPath, { withFileTypes: true });

  for (const entry of entries.sort((left, right) => left.name.localeCompare(right.name))) {
    const entryPath = path.join(dirPath, entry.name);
    if (entry.isDirectory()) {
      files.push(...listFilesRecursively(entryPath));
      continue;
    }

    if (entry.isFile()) files.push(entryPath);
  }

  return files;
}

function readTextFile(filePath: string): string {
  const buffer = fs.readFileSync(filePath);
  if (buffer.includes(0)) return '';
  return buffer.toString('utf8').trim();
}

function skillNameFromSource(source: string): string {
  if (isLikelyUrl(source)) {
    const url = new URL(source);
    if (url.protocol === 'file:') {
      return basenameWithoutExt(fileURLToPath(url));
    }
    return basenameWithoutExt(url.pathname) || sanitizeName(url.hostname);
  }

  return basenameWithoutExt(source);
}

function uniqueSkillName(name: string, skills: Skill[]): string {
  const base = sanitizeName(name || 'skill');
  let candidate = base;
  let counter = 2;

  while (
    skills.some(
      (skill) => skill.name.localeCompare(candidate, undefined, { sensitivity: 'accent' }) === 0,
    )
  ) {
    candidate = `${base}-${counter}`;
    counter += 1;
  }

  return candidate;
}

function basenameWithoutExt(value: string): string {
  const parsed = path.parse(value);
  return sanitizeName(parsed.name || parsed.base || 'skill');
}

function sanitizeName(value: string): string {
  const normalized = value.trim().replace(/\.[^.]+$/, '');
  const cleaned = normalized.replace(/[^a-z0-9_-]+/gi, '-').replace(/^-+|-+$/g, '');
  return cleaned || 'skill';
}

function skillDescriptionFromContent(content: string, source: SkillSource): string {
  const firstMeaningful = content
    .split(/\r?\n/)
    .map((line) => line.trim())
    .find((line) => line.length > 0);

  if (firstMeaningful) {
    return firstMeaningful.replace(/^#{1,6}\s*/, '').slice(0, 120);
  }

  return source.source === 'directory'
    ? `Directory skill from ${source.path}`
    : `Skill from ${source.path}`;
}

function isSkill(value: unknown): value is Skill {
  if (!value || typeof value !== 'object') return false;
  const skill = value as Record<string, unknown>;
  return (
    typeof skill.name === 'string' &&
    typeof skill.description === 'string' &&
    (skill.source === 'file' || skill.source === 'url' || skill.source === 'directory') &&
    typeof skill.path === 'string' &&
    typeof skill.active === 'boolean' &&
    skill.name.trim().length > 0
  );
}

interface SkillSource {
  source: Skill['source'];
  path: string;
}
