export interface GeneratePayload {
  goal: string;
  shell: string;
  prompt: string;
}

export function detectShell(): string {
  const candidates = [
    process.env.SHELL,
    process.env.ICOPILOT_SHELL,
    process.env.TERM_PROGRAM,
    process.env.ComSpec,
  ]
    .filter((value): value is string => typeof value === 'string' && value.trim().length > 0)
    .map((value) => value.toLowerCase());

  for (const candidate of candidates) {
    if (candidate.includes('pwsh') || candidate.includes('powershell')) return 'pwsh';
    if (candidate.includes('zsh')) return 'zsh';
    if (candidate.includes('fish')) return 'fish';
    if (candidate.includes('bash')) return 'bash';
  }

  return 'bash';
}

export function buildGeneratePrompt(goal: string, shell = detectShell()): GeneratePayload {
  const prompt = [
    `You are generating a complete, runnable ${shell} script for a developer.`,
    'Return only the script text.',
    'Use the requested shell dialect consistently.',
    'Include helpful comments that explain the major steps.',
    'Handle errors safely: enable set -e immediately when the shell supports it, and use the closest equivalent for other shells.',
    'Make the script executable as written with sensible defaults and clear variable names.',
    '',
    `Goal: ${goal}`,
  ].join('\n');

  return {
    goal,
    shell,
    prompt,
  };
}
