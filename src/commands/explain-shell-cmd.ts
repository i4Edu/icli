export interface ExplainShellPayload {
  command: string;
  prompt: string;
}

export function explainShellCommand(command: string): ExplainShellPayload {
  const displayCommand = command || '(empty command)';
  const prompt = [
    'You are explaining a shell command to a developer.',
    'Explain the command in plain English without assuming the user already knows the tool.',
    'Do not invent flags or behavior that are not present.',
    'Structure the answer as:',
    '1. A short summary of the command purpose',
    '2. A step-by-step breakdown of each subcommand, flag, argument, and shell operator',
    '3. Likely effects on files, history, network, or system state',
    '4. Risks, destructive behavior, or irreversible consequences',
    '5. Safer alternatives or precautions when relevant',
    'If the command is empty, incomplete, or ambiguous, say so clearly and explain what is missing.',
    '',
    `Command: ${displayCommand}`,
    `Raw command text: ${JSON.stringify(command)}`,
  ].join('\n');

  return {
    command,
    prompt,
  };
}
