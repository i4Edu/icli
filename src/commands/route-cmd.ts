import { PROFILES, type RoutingProfile, toProfile } from '../routing/profiles.js';
import { getProfile, setProfile } from '../routing/router.js';

export function routeCommand(arg: string): string {
  const [subcommand = 'get', profile] = arg.trim().split(/\s+/).filter(Boolean);

  switch (subcommand.toLowerCase()) {
    case 'get':
      return `routing profile: ${getProfile()}\n`;
    case 'list':
      return `routing profiles: ${Object.keys(PROFILES).join(', ')}\n`;
    case 'set': {
      const next = toProfile(profile);
      if (!next) {
        return `unknown routing profile: ${profile || '(missing)'}\n`;
      }
      setProfile(next as RoutingProfile);
      return `✔ routing profile → ${next}\n`;
    }
    default:
      return 'usage: /route get | /route set <cheap|balanced|strong|fixed> | /route list\n';
  }
}
