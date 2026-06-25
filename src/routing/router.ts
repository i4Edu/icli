import { PROFILES, type RoutingProfile, toProfile } from './profiles.js';

export interface RoutingState {
  profile: RoutingProfile;
}

export type TaskKind = 'plan' | 'chat' | 'edit' | 'review' | 'commit' | 'summarize';

const envProfile = toProfile(process.env.ICOPILOT_ROUTING);
const routingState: RoutingState = { profile: envProfile || 'fixed' };

export function setProfile(name: string): void {
  const profile = toProfile(name);
  if (!profile) {
    throw new Error(`Unknown routing profile: ${name}`);
  }
  routingState.profile = profile;
}

export function getProfile(): RoutingProfile {
  return routingState.profile;
}

export function pickModel(sessionDefault: string, task: TaskKind): string {
  const profile = routingState.profile;
  const routed = PROFILES[profile]?.[task];
  return profile === 'fixed' || !routed ? sessionDefault : routed;
}
