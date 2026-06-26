import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  activeProfile,
  deleteProfile,
  getProfile,
  loadProfiles,
  saveProfiles,
  setProfile,
  useProfile,
} from '../../src/config-profile.js';

let tmpDir: string;

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'icli-profile-'));
  process.env.ICOPILOT_PROFILES_PATH = path.join(tmpDir, 'profiles.json');
});

afterEach(() => {
  delete process.env.ICOPILOT_PROFILES_PATH;
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

describe('config profiles', () => {
  it('round-trips load and save', () => {
    saveProfiles({
      active: 'work',
      profiles: {
        work: { name: 'work', model: 'gpt-4o', theme: 'dark', sandbox: true, contextWarn: 0.85 },
      },
    });

    expect(loadProfiles()).toEqual({
      active: 'work',
      profiles: {
        work: { name: 'work', model: 'gpt-4o', theme: 'dark', sandbox: true, contextWarn: 0.85 },
      },
    });
  });

  it('validates setProfile names', () => {
    setProfile({ name: 'Work_1', model: 'gpt-4o-mini' });
    expect(getProfile('Work_1')).toMatchObject({ name: 'Work_1', model: 'gpt-4o-mini' });
    expect(() => setProfile({ name: '-bad' })).toThrow(/profile name/);
    expect(() => setProfile({ name: 'a'.repeat(34) })).toThrow(/profile name/);
  });

  it('changes the active profile', () => {
    setProfile({ name: 'work', model: 'gpt-4o' });
    expect(useProfile('work')).toMatchObject({ name: 'work', model: 'gpt-4o' });
    expect(loadProfiles().active).toBe('work');
    expect(activeProfile()).toMatchObject({ name: 'work' });
    expect(useProfile('missing')).toBeNull();
  });

  it('clears active when deleting the active profile', () => {
    setProfile({ name: 'work' });
    useProfile('work');

    expect(deleteProfile('work')).toBe(true);
    expect(loadProfiles()).toEqual({ active: null, profiles: {} });
    expect(deleteProfile('work')).toBe(false);
  });
});
