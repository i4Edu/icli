import { execSync } from 'node:child_process';
import { select, input } from '@inquirer/prompts';
import type { ChatCompletionMessageParam } from 'openai/resources/chat/completions';
import { streamChat } from '../api/github-models.js';
import type { Session } from '../session/session.js';
import { theme } from '../ui/theme.js';
import { box, commandChip } from '../ui/box.js';
import { copyTextToClipboard } from './clipboard-cmd.js';

const SUGGEST_SYSTEM_PROMPT = `You translate natural-language requests into exactly one shell command.
Respond with ONLY the command text.
Do not explain anything.
Do not use markdown fences.
Do not add bullets, labels, or commentary.
Prefer a safe, direct command that can run in the user's current working directory.`;

const REVISE_SYSTEM_PROMPT = `You are refining a shell command based on user feedback.
Respond with ONLY the revised command text.
Do not explain anything.
Do not use markdown fences.`;

type ShellTarget = 'bash' | 'zsh' | 'fish' | 'powershell' | 'cmd';

function detectShell(): ShellTarget {
  const shellEnv = process.env.SHELL ?? '';
  if (shellEnv.includes('zsh')) return 'zsh';
  if (shellEnv.includes('fish')) return 'fish';
  if (shellEnv.includes('bash')) return 'bash';
  if (process.platform === 'win32') return 'powershell';
  return 'bash';
}

async function pickShell(): Promise<ShellTarget> {
  const detected = detectShell();
  const allShells: Array<{ name: string; value: ShellTarget }> = [
    { name: `${detected} (detected)`, value: detected },
    { name: 'bash', value: 'bash' as ShellTarget },
    { name: 'zsh', value: 'zsh' as ShellTarget },
    { name: 'fish', value: 'fish' as ShellTarget },
    { name: 'powershell', value: 'powershell' as ShellTarget },
    { name: 'cmd', value: 'cmd' as ShellTarget },
  ];
  return select<ShellTarget>({
    message: 'What shell are you targeting?',
    choices: allShells.filter((c, i) => i === 0 || c.value !== detected),
  });
}

async function generateCommand(
  query: string,
  shell: ShellTarget,
  session: Session,
  signal: AbortSignal,
  priorCommand?: string,
  revision?: string,
): Promise<string> {
  const messages: ChatCompletionMessageParam[] = [
    { role: 'system', content: revision ? REVISE_SYSTEM_PROMPT : SUGGEST_SYSTEM_PROMPT },
    {
      role: 'user',
      content: revision
        ? `Original request: ${query}\nOriginal command: ${priorCommand}\nFeedback: ${revision}\nTarget shell: ${shell}\nCWD: ${session.state.cwd}`
        : `Target shell: ${shell}\nCurrent working directory: ${session.state.cwd}\nRequest: ${query}`,
    },
  ];

  let suggestion = '';
  const result = await streamChat({
    model: session.state.model,
    messages,
    temperature: 0.1,
    signal,
    onToken: (token) => {
      suggestion += token;
    },
  });

  return sanitizeSuggestion(result.content || suggestion);
}

async function explainCommand(
  command: string,
  session: Session,
  signal: AbortSignal,
): Promise<void> {
  const messages: ChatCompletionMessageParam[] = [
    {
      role: 'system',
      content:
        'Explain the shell command clearly: 1) one-sentence summary, 2) breakdown of each part, 3) any risks. Be concise.',
    },
    { role: 'user', content: `Explain: ${command}` },
  ];

  process.stdout.write(box('', { title: 'Explanation', style: 'response' }).slice(0, -1) + '\n');

  let explanation = '';
  await streamChat({
    model: session.state.model,
    messages,
    temperature: 0.2,
    signal,
    onToken: (token) => {
      explanation += token;
      process.stdout.write(token);
    },
  });
  process.stdout.write('\n');
}

async function executeCommand(command: string): Promise<void> {
  process.stdout.write(theme.dim(`\nRunning: ${command}\n\n`));
  try {
    execSync(command, { stdio: 'inherit', cwd: process.cwd() });
    process.stdout.write(theme.ok('\n✔ Command completed\n'));
  } catch (err: any) {
    process.stdout.write(theme.err(`\n✖ Command failed: ${err?.message ?? String(err)}\n`));
  }
}

export async function suggestCommand(
  query: string,
  session: Session,
  signal: AbortSignal,
): Promise<string> {
  const trimmedQuery = query.trim();
  if (!trimmedQuery) return theme.warn('usage: /suggest <request>\n');

  const shell = await pickShell();
  process.stdout.write(theme.dim(`\nGenerating ${shell} command…\n`));

  let command = await generateCommand(trimmedQuery, shell, session, signal);

  // Post-suggestion action loop — mirrors GitHub Copilot CLI's interactive UX
  while (true) {
    process.stdout.write('\n');
    process.stdout.write(box(commandChip(command), { title: 'Suggested command', style: 'command' }));

    type Action = 'execute' | 'copy' | 'explain' | 'revise' | 'exit';
    let action: Action;
    try {
      action = await select<Action>({
        message: 'What would you like to do?',
        choices: [
          { name: 'Execute this command', value: 'execute' },
          { name: 'Copy command to clipboard', value: 'copy' },
          { name: 'Explain this command', value: 'explain' },
          { name: 'Revise this command', value: 'revise' },
          { name: 'Exit', value: 'exit' },
        ],
      });
    } catch {
      // user Ctrl-C'd the menu
      break;
    }

    if (action === 'execute') {
      await executeCommand(command);
      break;
    }

    if (action === 'copy') {
      try {
        await copyTextToClipboard(command);
        process.stdout.write(theme.ok('✔ Command copied to clipboard\n'));
      } catch (err: any) {
        process.stdout.write(theme.err(`✖ Copy failed: ${err?.message ?? String(err)}\n`));
      }
      break;
    }

    if (action === 'explain') {
      await explainCommand(command, session, signal);
      // continue loop so user can still execute/copy
      continue;
    }

    if (action === 'revise') {
      let feedback: string;
      try {
        feedback = await input({ message: 'What should be different?' });
      } catch {
        break;
      }
      if (feedback.trim()) {
        process.stdout.write(theme.dim('\nRefining command…\n'));
        command = await generateCommand(trimmedQuery, shell, session, signal, command, feedback);
      }
      continue;
    }

    // exit
    break;
  }

  return '';
}

function sanitizeSuggestion(content: string): string {
  const withoutFences = content
    .trim()
    .replace(/^```(?:\w+)?\s*/u, '')
    .replace(/\s*```$/u, '')
    .trim();
  return withoutFences || 'echo "No command suggested"';
}
