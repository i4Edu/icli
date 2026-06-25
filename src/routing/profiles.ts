export type RoutingProfile = 'cheap' | 'balanced' | 'strong' | 'fixed';

export interface ProfileSpec {
  plan: string;
  chat: string;
  edit: string;
  review: string;
  commit: string;
  summarize: string;
}

const gpt4oMini = 'gpt-4o-mini';
const gpt4o = 'gpt-4o';

export const PROFILES: Record<RoutingProfile, ProfileSpec> = {
  cheap: {
    plan: gpt4oMini,
    chat: gpt4oMini,
    edit: gpt4oMini,
    review: gpt4oMini,
    commit: gpt4oMini,
    summarize: gpt4oMini,
  },
  balanced: {
    plan: gpt4oMini,
    chat: gpt4oMini,
    edit: gpt4o,
    review: gpt4o,
    commit: gpt4oMini,
    summarize: gpt4oMini,
  },
  strong: {
    plan: gpt4oMini,
    chat: gpt4o,
    edit: gpt4o,
    review: gpt4o,
    commit: gpt4o,
    summarize: gpt4oMini,
  },
  fixed: {
    plan: '',
    chat: '',
    edit: '',
    review: '',
    commit: '',
    summarize: '',
  },
};

export function profileFor(name: string | undefined): ProfileSpec {
  return PROFILES[toProfile(name) ?? 'balanced'];
}

export function toProfile(name: string | undefined): RoutingProfile | undefined {
  return name === 'cheap' || name === 'balanced' || name === 'strong' || name === 'fixed'
    ? name
    : undefined;
}
