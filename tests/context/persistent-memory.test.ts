import fs from 'node:fs';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { PersistentMemory } from '../../src/context/persistent-memory.js';

let baseDir: string;
let storeDir: string;
let projectDir: string;

beforeEach(() => {
  baseDir = path.join(process.cwd(), '.test-temp');
  fs.mkdirSync(baseDir, { recursive: true });
  storeDir = fs.mkdtempSync(path.join(baseDir, 'memory-store-'));
  projectDir = fs.mkdtempSync(path.join(baseDir, 'memory-project-'));
});

afterEach(() => {
  fs.rmSync(storeDir, { recursive: true, force: true });
  fs.rmSync(projectDir, { recursive: true, force: true });
});

describe('PersistentMemory', () => {
  it('persists entries per project and renders them as context', () => {
    const memory = new PersistentMemory(storeDir);
    const projectId = memory.getProjectId(projectDir);

    memory.remember('language', 'TypeScript');
    memory.remember('runner', 'vitest', 'auto');
    memory.save(projectId);

    const restored = new PersistentMemory(storeDir);
    restored.load(projectId);

    expect(restored.recall()).toEqual([
      {
        key: 'language',
        value: 'TypeScript',
        addedAt: expect.any(String),
        source: 'user',
      },
      {
        key: 'runner',
        value: 'vitest',
        addedAt: expect.any(String),
        source: 'auto',
      },
    ]);
    expect(restored.render()).toContain('## Persistent project memory');
    expect(restored.render()).toContain('- language: TypeScript');
    expect(restored.render()).toContain('- runner: vitest');
    expect(fs.existsSync(path.join(storeDir, `${projectId}.json`))).toBe(true);
  });

  it('filters, updates, and forgets entries', () => {
    const memory = new PersistentMemory(storeDir);

    memory.remember('stack', 'node typescript');
    memory.remember('stack', 'node typescript vitest', 'auto');
    memory.remember('shell', 'powershell');

    expect(memory.recall('vitest')).toEqual([
      {
        key: 'stack',
        value: 'node typescript vitest',
        addedAt: expect.any(String),
        source: 'auto',
      },
    ]);
    expect(memory.recall('shell')[0]?.value).toBe('powershell');
    expect(memory.forget('shell')).toBe(true);
    expect(memory.forget('missing')).toBe(false);
    expect(memory.recall().map((entry) => entry.key)).toEqual(['stack']);
  });

  it('uses stable project ids and isolates projects', () => {
    const memory = new PersistentMemory(storeDir);
    const otherProjectDir = fs.mkdtempSync(path.join(baseDir, 'memory-project-'));
    const firstId = memory.getProjectId(projectDir);
    const secondId = memory.getProjectId(otherProjectDir);

    try {
      expect(firstId).toBe(memory.getProjectId(projectDir));
      expect(firstId).not.toBe(secondId);
      if (process.platform === 'win32') {
        expect(firstId).toBe(memory.getProjectId(projectDir.toUpperCase()));
      }
    } finally {
      fs.rmSync(otherProjectDir, { recursive: true, force: true });
    }
  });

  it('treats missing stores as empty memory', () => {
    const memory = new PersistentMemory(storeDir);

    memory.load('missing-project');

    expect(memory.recall()).toEqual([]);
    expect(memory.render()).toBe('');
  });
});
