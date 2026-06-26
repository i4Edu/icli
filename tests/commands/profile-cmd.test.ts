import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { getProfile, loadProfiles, setProfile, useProfile } from '../../src/config-profile.js';
import { profileCommand } from '../../src/commands/profile-cmd.js';

let tmpDir: string;

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'icli-profile-cmd-'));
  process.env.ICOPILOT_PROFILES_PATH = path.join(tmpDir, 'profiles.json');
});

afterEach(() => {
  delete process.env.ICOPILOT_PROFILES_PATH;
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

describe('profileCommand', () => {
  it('lists profiles by default', async () => {
    expect(await profileCommand([])).toContain('No profiles saved');

    setProfile({ name: 'work' });
    setProfile({ name: 'home' });
    useProfile('work');

    const output = await profileCommand([]);
    expect(output).toContain('Profiles');
    expect(output).toContain('* work');
    expect(output).toContain('  home');
  });

  it('saves and shows a profile', async () => {
    await expect(
      profileCommand([
        'save',
        'work',
        'model=gpt-4o',
        'theme=dark',
        'sandbox=true',
        'baseUrl=https://example.test',
        'contextWarn=0.85',
      ]),
    ).resolves.toContain('saved profile work');

    const output = await profileCommand(['show', 'work']);
    expect(JSON.parse(output)).toEqual({
      name: 'work',
      model: 'gpt-4o',
      theme: 'dark',
      sandbox: true,
      baseUrl: 'https://example.test',
      contextWarn: 0.85,
    });
  });

  it('uses a profile', async () => {
    setProfile({ name: 'work', model: 'gpt-4o' });

    await expect(profileCommand(['use', 'work'])).resolves.toContain('active profile');
    expect(loadProfiles().active).toBe('work');
    await expect(profileCommand(['use', 'missing'])).resolves.toContain('profile not found');
  });

  it('deletes a profile', async () => {
    setProfile({ name: 'work' });

    await expect(profileCommand(['delete', 'work'])).resolves.toContain('deleted profile work');
    expect(getProfile('work')).toBeNull();
    await expect(profileCommand(['delete', 'work'])).resolves.toContain('profile not found');
  });

  it('reports invalid commands and options', async () => {
    await expect(profileCommand(['wat'])).resolves.toContain('usage: /profile');
    await expect(profileCommand(['save', 'work', 'sandbox=yes'])).resolves.toContain(
      'sandbox must be true or false',
    );
    await expect(profileCommand(['save', '-bad'])).resolves.toContain('profile name');
  });
});
