export interface FixPayload {
  error: string;
  prompt: string;
}

export function buildFixPrompt(errorText: string): FixPayload {
  const error = errorText;
  const trimmedError = errorText.trim();
  const quotedError = trimmedError.length > 0 ? trimmedError : '[no error text provided]';

  return {
    error,
    prompt: [
      'You are helping diagnose a CLI or developer tooling error.',
      'Identify the error shown below, explain the most likely root cause, and suggest 2-3 fixes ranked by likelihood.',
      'For each fix, include the exact commands to run and a short note about what the command does.',
      'If the error text is ambiguous, say so briefly and still provide the most plausible fixes first.',
      '',
      'Error text:',
      quotedError,
    ].join('\n'),
  };
}
