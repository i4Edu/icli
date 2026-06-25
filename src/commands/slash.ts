import fs from 'node:fs';
import path from 'node:path';
import { config } from '../config.js';
import { Session } from '../session/session.js';
import { theme } from '../ui/theme.js';
import { showDiff, commitFromStaged, prDescription } from './git.js';
import { compactSession } from '../context/compactor.js';
import { pickSession, exportSession } from '../session/manager.js';
import { reviewStaged, draftIssue, scaffoldBranch } from './git-extra.js';
import { indexCommand } from './index-cmd.js';
import { routeCommand } from './route-cmd.js';

export interface SlashContext {
  session: Session;
  abort: AbortController;
  /** signal the outer loop to terminate */
  exit: () => void;
}

export interface SlashResult {
  handled: boolean;
  /** if true, skip sending this input to the LLM */
  consumed: boolean;
}

const HELP = `
${theme.brand('Slash commands')}
  /help                      show this help
  /clear, /new               wipe conversation history
  /model <name>              switch GitHub Models model (e.g. gpt-4o)
  /cwd <path>                change repository context
  /diff                      show git diff (unstaged, then staged)
  /context                   show token usage vs budget
  /compact                   summarize conversation, free token space
  /sessions                  list and resume saved sessions
  /export [md|json] [path]   export current session transcript/state
  /plan                      toggle Plan Mode
  /commit                    generate semantic commit from staged diff
  /pr                        draft PR description (branch vs default)
  /review                    review staged changes
  /issue [title]             draft a GitHub issue from current context
  /branch <topic>            create a conventional feature/fix branch
  /index build|status|search workspace embeddings index
  /route get|set|list        multi-model routing profile
  /exit, /quit               quit iCopilot

${theme.brand('Inline')}
  @path/to/file              inject file contents into next message
  Ctrl-C                     interrupt streaming (does not exit)
`;

export async function handleSlash(line: string, ctx: SlashContext): Promise<SlashResult> {
  const trimmed = line.trim();
  if (!trimmed.startsWith('/')) return { handled: false, consumed: false };

  const [cmd, ...rest] = trimmed.slice(1).split(/\s+/);
  const arg = rest.join(' ').trim();
  const s = ctx.session;

  switch (cmd.toLowerCase()) {
    case 'help':
      process.stdout.write(HELP);
      return done();
    case 'clear':
    case 'new':
      s.reset();
      process.stdout.write(theme.ok('✔ history cleared.\n'));
      return done();
    case 'model':
      if (!arg) {
        process.stdout.write(theme.dim(`current model: ${s.state.model}\n`));
      } else {
        s.setModel(arg);
        process.stdout.write(theme.ok(`✔ model → ${arg}\n`));
      }
      return done();
    case 'cwd':
      if (!arg) {
        process.stdout.write(theme.dim(`cwd: ${s.state.cwd}\n`));
      } else {
        const next = path.resolve(s.state.cwd, arg);
        if (!fs.existsSync(next) || !fs.statSync(next).isDirectory()) {
          process.stdout.write(theme.err(`not a directory: ${next}\n`));
        } else {
          config.cwd = next;
          s.setCwd(next);
          process.stdout.write(theme.ok(`✔ cwd → ${next}\n`));
        }
      }
      return done();
    case 'diff':
      await showDiff();
      return done();
    case 'context': {
      const used = s.tokenUsage();
      const cap = config.contextWindow;
      const pct = ((used / cap) * 100).toFixed(1);
      const bar = renderBar(used, cap, 30);
      process.stdout.write(
        `\n  tokens used: ${theme.hl(String(used))} / ${cap}  (${pct}%)\n  ${bar}\n  messages: ${s.state.messages.length}\n\n`,
      );
      if (used / cap > config.contextWarn) {
        process.stdout.write(theme.warn('  ⚠  approaching budget — consider /compact\n'));
      }
      return done();
    }
    case 'compact': {
      const summary = await compactSession(s, ctx.abort.signal);
      s.compactInto(summary);
      process.stdout.write(theme.ok('\n✔ history compacted.\n'));
      return done();
    }
    case 'sessions': {
      const id = await pickSession();
      if (!id) {
        process.stdout.write(theme.warn('No saved session selected.\n'));
      } else {
        Object.assign(ctx.session, Session.load(id));
        process.stdout.write(theme.ok(`✔ resumed session ${id}\n`));
      }
      return done();
    }
    case 'export': {
      const [formatArg, ...pathParts] = rest;
      const format = formatArg === 'json' ? 'json' : 'md';
      const outPath =
        formatArg === 'md' || formatArg === 'json'
          ? pathParts.join(' ').trim() || undefined
          : rest.join(' ').trim() || undefined;
      const written = await exportSession(s, format, outPath);
      process.stdout.write(theme.ok(`✔ exported ${written}\n`));
      return done();
    }
    case 'plan': {
      const next = s.state.mode === 'plan' ? 'ask' : 'plan';
      s.setMode(next);
      process.stdout.write(theme.ok(`✔ mode → ${next}\n`));
      return done();
    }
    case 'commit':
      await commitFromStaged(s, ctx.abort.signal);
      return done();
    case 'pr':
      await prDescription(s, ctx.abort.signal);
      return done();
    case 'review':
      await reviewStaged(s, ctx.abort.signal);
      return done();
    case 'issue':
      await draftIssue(s, ctx.abort.signal, arg || undefined);
      return done();
    case 'branch':
      await scaffoldBranch(s, ctx.abort.signal, arg);
      return done();
    case 'index':
      await indexCommand(rest);
      return done();
    case 'route':
      process.stdout.write(routeCommand(arg));
      return done();
    case 'exit':
    case 'quit':
      ctx.exit();
      return done();
    default:
      process.stdout.write(theme.warn(`unknown command: /${cmd}  (try /help)\n`));
      return done();
  }
}

function done(): SlashResult {
  return { handled: true, consumed: true };
}

function renderBar(used: number, cap: number, width: number): string {
  const ratio = Math.min(1, used / cap);
  const fill = Math.round(width * ratio);
  const bar = '█'.repeat(fill) + '░'.repeat(width - fill);
  const colored = ratio > 0.9 ? theme.err(bar) : ratio > 0.75 ? theme.warn(bar) : theme.ok(bar);
  return `[${colored}]`;
}
