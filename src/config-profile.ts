import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

export interface Profile {
  name: string;
  model?: string;
  theme?: 'auto' | 'light' | 'dark' | 'no-color';
  sandbox?: boolean;
  baseUrl?: string;
  contextWarn?: number;
}

interface ProfilesData {
  active: string | null;
  profiles: Record<string, Profile>;
}

const NAME_RE = /^[a-z0-9][a-z0-9_-]{0,32}$/i;

export function profilesPath(): string {
  return process.env.ICOPILOT_PROFILES_PATH || path.join(os.homedir(), '.icopilot', 'profiles.json');
}

export function loadProfiles(): ProfilesData {
  const file = profilesPath();
  if (!fs.existsSync(file)) return { active: null, profiles: {} };

  const parsed = JSON.parse(fs.readFileSync(file, 'utf8')) as Partial<ProfilesData>;
  const profiles =
    parsed.profiles && typeof parsed.profiles === 'object' && !Array.isArray(parsed.profiles)
      ? parsed.profiles
      : {};

  return {
    active: typeof parsed.active === 'string' ? parsed.active : null,
    profiles,
  };
}

export function saveProfiles(data: ProfilesData): void {
  const file = profilesPath();
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify(data, null, 2) + '\n', 'utf8');
}

export function listProfiles(): { active: string | null; names: string[] } {
  const data = loadProfiles();
  return { active: data.active, names: Object.keys(data.profiles).sort((a, b) => a.localeCompare(b)) };
}

export function getProfile(name: string): Profile | null {
  return loadProfiles().profiles[name] ?? null;
}

export function setProfile(profile: Profile): void {
  if (!NAME_RE.test(profile.name)) {
    throw new Error('profile name must match /^[a-z0-9][a-z0-9_-]{0,32}$/i');
  }

  const data = loadProfiles();
  data.profiles[profile.name] = { ...profile };
  saveProfiles(data);
}

export function deleteProfile(name: string): boolean {
  const data = loadProfiles();
  if (!data.profiles[name]) return false;

  delete data.profiles[name];
  if (data.active === name) data.active = null;
  saveProfiles(data);
  return true;
}

export function useProfile(name: string): Profile | null {
  const data = loadProfiles();
  const profile = data.profiles[name] ?? null;
  if (!profile) return null;

  data.active = name;
  saveProfiles(data);
  return profile;
}

export function activeProfile(): Profile | null {
  const data = loadProfiles();
  return data.active ? data.profiles[data.active] ?? null : null;
}
