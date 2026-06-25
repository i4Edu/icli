import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

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
  const global = readMemory(path.join(os.homedir(), '.icopilot', 'memory.md'));
  const sections: string[] = [];
  if (project) sections.push(`## Project memory\n${project}`);
  if (global) sections.push(`## Global memory\n${global}`);
  return sections.length ? sections.join('\n\n') : null;
}
