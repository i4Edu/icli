import { theme } from '../ui/theme.js';
import {
  deleteProfile,
  getProfile,
  listProfiles,
  setProfile,
  useProfile,
  type Profile,
} from '../config-profile.js';

const THEMES = new Set(['auto', 'light', 'dark', 'no-color']);

export async function profileCommand(rest: string[]): Promise<string> {
  const [sub = 'list', ...args] = rest;

  try {
    switch (sub) {
      case 'list':
        return listCommand();
      case 'use':
        return useCommand(args[0]);
      case 'save':
        return saveCommand(args);
      case 'show':
        return showCommand(args[0]);
      case 'delete':
        return deleteCommand(args[0]);
      default:
        return theme.warn('usage: /profile [list|use|save|show|delete]\n');
    }
  } catch (err) {
    return theme.err(`profile: ${(err as Error)?.message || err}\n`);
  }
}

function listCommand(): string {
  const { active, names } = listProfiles();
  if (names.length === 0) return theme.dim('No profiles saved.\n');

  return [
    theme.brand('Profiles'),
    ...names.map((name) => `${active === name ? '*' : ' '} ${name}`),
    '',
  ].join('\n');
}

function useCommand(name: string | undefined): string {
  if (!name) return theme.warn('usage: /profile use <name>\n');

  const profile = useProfile(name);
  if (!profile) return theme.warn(`profile not found: ${name}\n`);
  return theme.ok(`✔ active profile → ${name}\n`);
}

function saveCommand(args: string[]): string {
  const [name, ...pairs] = args;
  if (!name) return theme.warn('usage: /profile save <name> [k=v ...]\n');

  const profile: Profile = { ...(getProfile(name) ?? { name }), name };
  for (const pair of pairs) {
    const parsed = parsePair(pair);
    if (!parsed) return theme.warn(`ignored invalid option: ${pair}\n`);
    Object.assign(profile, parsed);
  }

  setProfile(profile);
  return theme.ok(`✔ saved profile ${name}\n`);
}

function showCommand(name: string | undefined): string {
  if (!name) return theme.warn('usage: /profile show <name>\n');

  const profile = getProfile(name);
  if (!profile) return theme.warn(`profile not found: ${name}\n`);
  return theme.hl(JSON.stringify(profile, null, 2)) + '\n';
}

function deleteCommand(name: string | undefined): string {
  if (!name) return theme.warn('usage: /profile delete <name>\n');

  return deleteProfile(name)
    ? theme.ok(`✔ deleted profile ${name}\n`)
    : theme.warn(`profile not found: ${name}\n`);
}

function parsePair(pair: string): Partial<Profile> | null {
  const eq = pair.indexOf('=');
  if (eq <= 0) return null;

  const key = pair.slice(0, eq);
  const value = pair.slice(eq + 1);

  switch (key) {
    case 'model':
      return { model: value };
    case 'theme':
      if (!THEMES.has(value)) throw new Error('theme must be auto, light, dark, or no-color');
      return { theme: value as Profile['theme'] };
    case 'sandbox':
      if (value !== 'true' && value !== 'false') throw new Error('sandbox must be true or false');
      return { sandbox: value === 'true' };
    case 'baseUrl':
      return { baseUrl: value };
    case 'contextWarn': {
      const contextWarn = Number(value);
      if (!Number.isFinite(contextWarn)) throw new Error('contextWarn must be a number');
      return { contextWarn };
    }
    default:
      throw new Error(`unknown profile key: ${key}`);
  }
}
