export type MessageModePrefix = 'ask' | 'code' | 'architect' | 'reason';

export interface ModePrefixResolution {
  matched: boolean;
  consumed: boolean;
  forwardInput?: string;
  turnMode?: MessageModePrefix;
  usage?: string;
}

export function parseModePrefix(input: string): {
  mode: MessageModePrefix | null;
  message: string;
} {
  const trimmed = input.trim();
  const match = trimmed.match(/^\/(ask|code|architect|reason)(?:\s+(.*))?$/i);
  if (!match) {
    return { mode: null, message: input };
  }

  return {
    mode: match[1].toLowerCase() as MessageModePrefix,
    message: (match[2] ?? '').trim(),
  };
}

export function resolveModePrefix(input: string): ModePrefixResolution {
  const parsed = parseModePrefix(input);
  if (!parsed.mode) {
    return { matched: false, consumed: false };
  }
  if (!parsed.message) {
    return {
      matched: true,
      consumed: true,
      usage: `usage: /${parsed.mode} <message>`,
    };
  }
  return {
    matched: true,
    consumed: false,
    forwardInput: parsed.message,
    turnMode: parsed.mode,
  };
}
