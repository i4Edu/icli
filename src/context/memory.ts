import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { PersistentMemory } from './persistent-memory.js';
import { TeamMemory } from './team-memory.js';

const MAX_MEMORY_BYTES = 16 * 1024;

function readMemory(file: string): string | null {
  try {
    if (!fs.existsSync(file) || !fs.statSync(file).isFile()) return null;
    const text = fs.readFileSync(file, 'utf8').slice(0, MAX_MEMORY_BYTES).trim();
    return text || null;
  } catch {
    return null;
  }
}

export function loadMemoryBlock(cwd: string): string | null {
  const project = readMemory(path.join(cwd, '.icopilot', 'memory.md'));
  const team = readTeamMemory(cwd);
  const global = readMemory(path.join(os.homedir(), '.icopilot', 'memory.md'));
  const persistent = readPersistentMemory(cwd);
  const sections: string[] = [];
  if (project) sections.push(`## Project memory\n${project}`);
  if (team) sections.push(team);
  if (global) sections.push(`## Global memory\n${global}`);
  if (persistent) sections.push(persistent);
  return sections.length ? sections.join('\n\n') : null;
}

function readPersistentMemory(cwd: string): string | null {
  try {
    const memory = new PersistentMemory();
    memory.load(memory.getProjectId(cwd));
    const rendered = memory.render().slice(0, MAX_MEMORY_BYTES).trim();
    return rendered || null;
  } catch {
    return null;
  }
}

function readTeamMemory(cwd: string): string | null {
  try {
    const memory = new TeamMemory();
    memory.load(cwd);
    const rendered = memory.render().slice(0, MAX_MEMORY_BYTES).trim();
    return rendered || null;
  } catch {
    return null;
  }
}
