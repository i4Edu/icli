import type { ChatCompletionMessageParam } from 'openai/resources/chat/completions';
import { streamChat } from '../api/github-models.js';
import type { CloudRoutine } from './routine-storage.js';
import { Session } from '../session/session.js';

export class CloudRoutineExecutor {
  async execute(routine: CloudRoutine): Promise<void> {
    const session = new Session({ mode: 'ask' });
    await session.initializeGitContext();

    const messages: ChatCompletionMessageParam[] = [
      {
        role: 'user',
        content: routine.prompt,
      },
    ];

    let output = '';
    const result = await streamChat({
      model: session.state.model,
      messages,
      onToken: (token) => {
        output += token;
      },
    });

    session.push({
      role: 'user',
      content: routine.prompt,
    });

    session.push({
      role: 'assistant',
      content: result.content || output,
    });
  }
}

export function createCloudRoutineExecutor(): (routine: CloudRoutine) => Promise<void> {
  const executor = new CloudRoutineExecutor();
  return (routine: CloudRoutine) => executor.execute(routine);
}
