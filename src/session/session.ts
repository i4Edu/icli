import fs from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import type { ChatCompletionMessageParam } from 'openai/resources/chat/completions';
import { config } from '../config.js';
import { countTokensSync } from '../util/tokens.js';

export type Mode = 'ask' | 'plan';

export interface SessionState {
  id: string;
  createdAt: string;
  model: string;
  mode: Mode;
  cwd: string;
  messages: ChatCompletionMessageParam[];
}

export interface SessionListItem {
  id: string;
  file: string;
  createdAt: string;
  mtime: Date;
  model: string;
  messageCount: number;
}

export class Session {
  state: SessionState;
  private file: string;

  constructor(init?: Partial<SessionState>) {
    const id = init?.id || randomUUID();
    this.state = {
      id,
      createdAt: init?.createdAt || new Date().toISOString(),
      model: init?.model || config.defaultModel,
      mode: init?.mode || 'ask',
      cwd: init?.cwd || config.cwd,
      messages: init?.messages || [],
    };
    fs.mkdirSync(config.sessionDir, { recursive: true });
    this.file = path.join(config.sessionDir, `${id}.json`);
  }

  static list(): SessionListItem[] {
    try {
      if (!fs.existsSync(config.sessionDir)) return [];
      return fs
        .readdirSync(config.sessionDir)
        .filter((name) => name.endsWith('.json'))
        .map((name) => {
          const file = path.join(config.sessionDir, name);
          const stat = fs.statSync(file);
          let state: Partial<SessionState> = {};
          try {
            state = JSON.parse(fs.readFileSync(file, 'utf8')) as Partial<SessionState>;
          } catch {
            /* keep best-effort listing */
          }
          const id = String(state.id || path.basename(name, '.json'));
          return {
            id,
            file,
            createdAt: String(state.createdAt || stat.birthtime.toISOString()),
            mtime: stat.mtime,
            model: String(state.model || config.defaultModel),
            messageCount: Array.isArray(state.messages) ? state.messages.length : 0,
          };
        })
        .sort((a, b) => b.mtime.getTime() - a.mtime.getTime());
    } catch {
      return [];
    }
  }

  static load(id: string): Session {
    const safeId = path.basename(id, '.json');
    const file = path.join(config.sessionDir, `${safeId}.json`);
    const state = JSON.parse(fs.readFileSync(file, 'utf8')) as Partial<SessionState>;
    return new Session(state);
  }

  push(msg: ChatCompletionMessageParam) {
    this.state.messages.push(msg);
    this.persist();
  }

  reset() {
    this.state.messages = [];
    this.persist();
  }

  setModel(m: string) {
    this.state.model = m;
    this.persist();
  }
  setMode(m: Mode) {
    this.state.mode = m;
    this.persist();
  }
  setCwd(p: string) {
    this.state.cwd = p;
    this.persist();
  }

  persist() {
    try {
      fs.writeFileSync(this.file, JSON.stringify(this.state, null, 2), 'utf8');
    } catch {
      /* ignore persistence errors */
    }
  }

  /** Total token usage estimate over current message history. */
  tokenUsage(): number {
    let total = 0;
    for (const m of this.state.messages) {
      const c =
        typeof m.content === 'string'
          ? m.content
          : Array.isArray(m.content)
            ? m.content.map((p: any) => (typeof p?.text === 'string' ? p.text : '')).join('\n')
            : '';
      if (c) {
        try {
          total += countTokensSync(c);
        } catch {
          total += Math.ceil(c.length / 4);
        }
      }
    }
    return total;
  }

  toJSON(): string {
    return JSON.stringify(this.state, null, 2);
  }

  toMarkdown(): string {
    const lines = [
      `# iCopilot session ${this.state.id}`,
      '',
      `- Created: ${this.state.createdAt}`,
      `- Model: ${this.state.model}`,
      `- CWD: ${this.state.cwd}`,
      `- Messages: ${this.state.messages.length}`,
      '',
    ];

    for (const message of this.state.messages) {
      const role = String((message as any).role || 'message');
      const name =
        role === 'tool'
          ? ` ${(message as any).tool_call_id || ''}`.trimEnd()
          : (message as any).name
            ? ` ${(message as any).name}`
            : '';
      lines.push(`## ${role}${name}`, '');
      const content = contentToText((message as any).content);
      if (content.trim()) lines.push(content.trim());
      const toolCalls = (message as any).tool_calls;
      if (Array.isArray(toolCalls) && toolCalls.length) {
        lines.push('', '```json');
        lines.push(JSON.stringify(toolCalls, null, 2));
        lines.push('```');
      }
      lines.push('');
    }

    return lines.join('\n').trimEnd() + '\n';
  }

  shouldAutoSummarize(threshold = 0.85): boolean {
    return this.tokenUsage() / config.contextWindow > threshold;
  }

  /** Replace history with a compacted summary message. */
  compactInto(summary: string) {
    this.state.messages = [
      {
        role: 'system',
        content: `Conversation summary (auto-compacted to save tokens):\n\n${summary}`,
      },
    ];
    this.persist();
  }
}

function contentToText(content: unknown): string {
  if (typeof content === 'string') return content;
  if (Array.isArray(content)) {
    return content
      .map((part: any) => {
        if (typeof part?.text === 'string') return part.text;
        if (typeof part?.type === 'string') return JSON.stringify(part);
        return '';
      })
      .filter(Boolean)
      .join('\n');
  }
  if (content == null) return '';
  return JSON.stringify(content, null, 2);
}
