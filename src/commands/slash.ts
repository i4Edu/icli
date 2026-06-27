import fs from 'node:fs';
import path from 'node:path';
import { config } from '../config.js';
import { Session } from '../session/session.js';
import { theme } from '../ui/theme.js';
import { showDiff, commitFromStaged, prDescription } from './git.js';
import { compactSession } from '../context/compactor.js';
import { PinnedContext } from '../context/pinned.js';
import { pickSession, exportSession } from '../session/manager.js';
import { reviewStaged, draftIssue, scaffoldBranch } from './git-extra.js';
import { indexCommand } from './index-cmd.js';
import { routeCommand } from './route-cmd.js';
import { undoCommand } from './undo-cmd.js';
import { costCommand } from './cost-cmd.js';
import { snippetsCommand } from './snippets-cmd.js';
import { profileCommand } from './profile-cmd.js';
import { statsCommand } from './stats-cmd.js';
import { buildExplain } from './explain-cmd.js';
import { lintCommand } from './lint-cmd.js';
import { testCommand } from './test-cmd.js';
import { depsCommand } from './deps-cmd.js';
import { bookmarkCommand } from './bookmark-cmd.js';
import { historyCommand } from './history-cmd.js';
import { searchCommand } from './search-cmd.js';
import { refactorCommand } from './refactor-cmd.js';
import { suggestCommand } from './suggest-cmd.js';
import { buildSummary } from './summary-cmd.js';
import { compareCommand } from './compare-cmd.js';
import { gitLogCommand } from './git-log-cmd.js';
import { envCommand } from './env-cmd.js';
import { TodoList, todoCommand } from './todo-cmd.js';
import { tokensCommand } from './tokens-cmd.js';
import { stashCommand } from './stash-cmd.js';
import { buildChangelogPrompt } from './changelog-cmd.js';
import { buildFixPrompt } from './fix-cmd.js';
import { securityCommand } from './security-cmd.js';
import { formatInitResult, initProject } from './init-cmd.js';
import { templateCommand } from './template-cmd.js';
import { aliasCommand } from './alias-cmd.js';
import { MetricsCollector, metricsCommand } from './metrics-cmd.js';
import { reviewDiff } from './diff-review-cmd.js';
import { formatDiagnostics, runDiagnostics } from './doctor-cmd.js';
import { explainShellCommand } from './explain-shell-cmd.js';
import { buildGeneratePrompt } from './generate-cmd.js';
import { buildMultiConfig, formatMultiResponses } from './multi-cmd.js';
import { agentCommand } from './agent-cmd.js';
import { exploreCommand } from './explore-cmd.js';
import { skillCommand } from './skill-cmd.js';
import { backgroundTaskManager } from '../modes/background.js';
import { runAutopilot } from '../modes/autopilot.js';
import { taskCommand } from './task-cmd.js';
import { watchCommand } from './watch-cmd.js';
import { memoryCommand } from './memory-cmd.js';
import { contextCommand } from './context-cmd.js';
import { shareCommand } from '../session/share.js';
import { extensionCommand } from '../extensions/loader.js';

export interface SlashContext {
  session: Session;
  abort: AbortController;
  metrics?: MetricsCollector;
  /** signal the outer loop to terminate */
  exit: () => void;
}

export interface SlashResult {
  handled: boolean;
  /** if true, skip sending this input to the LLM */
  consumed: boolean;
  /** optional transformed input to forward to the LLM */
  forwardInput?: string;
}

const HELP = `
${theme.brand('Slash commands')}
  /help                      show this help
  /clear, /new               wipe conversation history
  /model <name>              switch GitHub Models model (e.g. gpt-4o)
  /cwd <path>                change repository context
  /diff                      show git diff (unstaged, then staged)
  /git-log                   show recent git commits
  /context [view]            show context hub (sources, budget, trim)
  /pin <file>                pin a file to persistent context (or list pinned files)
  /unpin <file|--all>        remove pinned files from persistent context
  /tokens                    show detailed token usage breakdown
  /history                   browse recent conversation history
  /compact                   summarize conversation, free token space
  /sessions                  list and resume saved sessions
  /export [md|json] [path]   export current session transcript/state
  /share                     share session bundles and clipboard exports
  /plan                      toggle Plan Mode
  /autopilot [goal]          toggle autopilot or run a goal immediately
  /commit                    generate semantic commit from staged diff
  /pr                        draft PR description (branch vs default)
  /review                    review staged changes
  /diff-review [target]      review any diff (unstaged, staged, branch, range, file)
  /issue [title]             draft a GitHub issue from current context
  /branch <topic>            create a conventional feature/fix branch
  /index build|status|search workspace embeddings index
  /search <query>            semantic search over indexed workspace code
  /route get|set|list        multi-model routing profile
  /undo [status], /redo       undo or redo approved file writes
  /cost                       estimate current session token cost
  /snippets, /snippet         manage reusable prompt snippets
  /profile, /profiles         manage saved CLI profiles
  /stats [show|reset|path]    show or reset local usage stats
  /explain <path>             build an explanation prompt for a file/folder
  /suggest <request>          suggest a shell command for a task
  /summary                    build a project architecture summary prompt
  /compare <file-a> <file-b>  compare two files with diff + AI prompt
  /env [--full|--check VAR]   show current environment context
  /template [name] [--apply]  scaffold a built-in project template
  /changelog [range|--last]   build a changelog prompt from git commits
  /fix <error>                build an AI troubleshooting prompt for an error
  /lint                       detect available repository linters
  /test                       detect available repository test frameworks
  /doctor                     diagnose local iCopilot setup
  /todo                       track session todos
  /task, /tasks               inspect background tasks
  /deps                       inspect project dependencies
  /init [--force]             create .icopilot project configuration
  /security                   scan for common secrets and credential leaks
  /refactor <subcommand>      build an AI refactor prompt
  /metrics                    show session performance metrics
  /bookmark, /bookmarks       manage session rewind bookmarks
  /alias [list|set|remove]    manage custom command aliases
  /skill                      manage reusable skill sources
  /stash                      stash conversation state for later
  /explain-shell <cmd>        explain a shell command step by step
  /generate <goal>            generate a shell command for a goal
  /multi <models> <prompt>    query multiple models in parallel
  /agent <type> [query]       build a specialized agent delegation prompt
  /explore <question>         explore codebase with AI agent
  /watch <pattern> <cmd>      file watcher configuration
  /memory                     manage persistent project memory
  /extension [list|info|reload] inspect local extensions
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
    case 'git-log':
      process.stdout.write(await gitLogCommand(rest, s.state.cwd));
      return done();
    case 'context':
      process.stdout.write(contextCommand(rest, s));
      return done();
    case 'pin': {
      const pinned = PinnedContext.fromJSON(s.state.pinned);
      if (!arg) {
        process.stdout.write(formatPinnedFiles(pinned.list()));
        return done();
      }

      const added = pinned.add(arg, s.state.cwd);
      if (!added) {
        process.stdout.write(theme.err(`unable to pin file: ${path.resolve(s.state.cwd, arg)}\n`));
        return done();
      }

      s.setPinned(pinned.toJSON());
      process.stdout.write(theme.ok(`✔ pinned ${added.path} (${added.tokens} tokens)\n`));
      return done();
    }
    case 'unpin': {
      const pinned = PinnedContext.fromJSON(s.state.pinned);
      if (!arg) {
        process.stdout.write(theme.warn('usage: /unpin <path|--all>\n'));
        return done();
      }
      if (arg === '--all') {
        const totalTokens = pinned.totalTokens();
        const removed = pinned.clear();
        s.setPinned(pinned.toJSON());
        process.stdout.write(
          theme.ok(
            `✔ cleared ${removed} pinned file${removed === 1 ? '' : 's'} (${totalTokens} tokens)\n`,
          ),
        );
        return done();
      }

      const target = path.resolve(s.state.cwd, arg);
      const removedFile = pinned.list().find((file) => path.normalize(file.path) === path.normalize(target));
      if (!pinned.remove(target)) {
        process.stdout.write(theme.warn(`not pinned: ${target}\n`));
        return done();
      }

      s.setPinned(pinned.toJSON());
      process.stdout.write(
        theme.ok(`✔ unpinned ${target} (${removedFile?.tokens ?? 0} tokens)\n`),
      );
      return done();
    }
    case 'tokens':
      process.stdout.write(tokensCommand(s));
      return done();
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
    case 'share':
      process.stdout.write(shareCommand(rest, s));
      return done();
    case 'plan': {
      const next = s.state.mode === 'plan' ? 'ask' : 'plan';
      s.setMode(next);
      process.stdout.write(theme.ok(`✔ mode → ${next}\n`));
      return done();
    }
    case 'autopilot':
      if (!arg) {
        const next = !s.state.autopilotEnabled;
        s.setAutopilotEnabled(next);
        process.stdout.write(theme.ok(`✔ autopilot → ${next ? 'on' : 'off'}\n`));
        return done();
      }
      await runAutopilot(arg, { session: s, signal: ctx.abort.signal });
      return done();
    case 'commit':
      await commitFromStaged(s, ctx.abort.signal);
      return done();
    case 'pr':
      await prDescription(s, ctx.abort.signal);
      return done();
    case 'review':
      await reviewStaged(s, ctx.abort.signal);
      return done();
    case 'diff-review':
      await reviewDiff(s, rest, ctx.abort.signal);
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
    case 'search':
      process.stdout.write(await searchCommand(rest, s.state.cwd));
      return done();
    case 'route':
      process.stdout.write(routeCommand(arg));
      return done();
    case 'undo':
      process.stdout.write(await undoCommand(arg.toLowerCase() === 'status' ? 'status' : 'undo'));
      return done();
    case 'redo':
      process.stdout.write(await undoCommand('redo'));
      return done();
    case 'cost':
      process.stdout.write(costCommand(s));
      return done();
    case 'snippets':
    case 'snippet':
      process.stdout.write(await snippetsCommand(rest));
      return done();
    case 'profile':
    case 'profiles':
      process.stdout.write(await profileCommand(rest));
      return done();
    case 'stats':
      process.stdout.write(statsCommand(arg || undefined));
      return done();
    case 'metrics':
      process.stdout.write(metricsCommand(ctx.metrics ?? new MetricsCollector()));
      return done();
    case 'explain': {
      if (!arg) {
        process.stdout.write(theme.warn('usage: /explain <path>\n'));
        return done();
      }
      const payload = buildExplain(arg, s.state.cwd);
      process.stdout.write(
        `${theme.brand('Explain prompt')} ${theme.dim(payload.path)}\n\n${payload.prompt}\n`,
      );
      return done();
    }
    case 'suggest':
      process.stdout.write(await suggestCommand(arg, s, ctx.abort.signal));
      return done();
    case 'summary': {
      const payload = buildSummary(s.state.cwd);
      process.stdout.write(
        `${theme.brand('Summary prompt')} ${theme.dim(payload.projectName)}\n\n${payload.prompt}\n`,
      );
      return done();
    }
    case 'compare':
      process.stdout.write(compareCommand(rest, s.state.cwd));
      return done();
    case 'env':
      process.stdout.write(envCommand(rest));
      return done();
    case 'template':
      process.stdout.write(templateCommand(rest));
      return done();
    case 'changelog': {
      const payload = await buildChangelogPrompt(rest, s.state.cwd);
      const label =
        payload.fromRef && payload.toRef ? `${payload.fromRef}..${payload.toRef}` : s.state.cwd;
      process.stdout.write(
        `${theme.brand('Changelog prompt')} ${theme.dim(label)}\n\n${payload.prompt}\n`,
      );
      return done();
    }
    case 'fix': {
      const payload = buildFixPrompt(arg);
      process.stdout.write(`${theme.brand('Fix prompt')}\n\n${payload.prompt}\n`);
      return done();
    }
    case 'lint':
      process.stdout.write(lintCommand(s.state.cwd));
      return done();
    case 'test':
      process.stdout.write(testCommand(s.state.cwd));
      return done();
    case 'doctor':
      process.stdout.write(formatDiagnostics(runDiagnostics()));
      return done();
    case 'todo':
    case 'todos': {
      const todoState = s.state as typeof s.state & { todos?: unknown };
      const todos = TodoList.fromJSON(todoState.todos);
      process.stdout.write(todoCommand(rest, todos));
      s.setTodos(todos.toJSON());
      return done();
    }
    case 'task':
      process.stdout.write(taskCommand(rest, backgroundTaskManager));
      return done();
    case 'tasks':
      process.stdout.write(taskCommand(['list'], backgroundTaskManager));
      return done();
    case 'deps':
      process.stdout.write(depsCommand(s.state.cwd));
      return done();
    case 'init': {
      const force = rest.includes('--force');
      process.stdout.write(formatInitResult(initProject(s.state.cwd, { force })));
      return done();
    }
    case 'security':
      process.stdout.write(securityCommand(s.state.cwd));
      return done();
    case 'refactor':
      process.stdout.write(refactorCommand(rest, s.state.cwd));
      return done();
    case 'bookmark':
    case 'bookmarks': {
      const result = bookmarkCommand(s, rest);
      process.stdout.write(result.message.endsWith('\n') ? result.message : `${result.message}\n`);
      if (result.rewindTo !== undefined) {
        s.state.messages.length = Math.min(s.state.messages.length, result.rewindTo + 1);
        const save = (s as unknown as { save?: () => void }).save;
        if (typeof save === 'function') save.call(s);
        process.stdout.write(theme.ok(`✔ rewound to message ${result.rewindTo}\n`));
      }
      return done();
    }
    case 'alias':
      process.stdout.write(aliasCommand(rest));
      return done();
    case 'skill':
      process.stdout.write(skillCommand(rest));
      return done();
    case 'history':
      process.stdout.write(historyCommand(rest, s));
      return done();
    case 'stash':
      process.stdout.write(stashCommand(rest, s));
      return done();
    case 'explain-shell': {
      const payload = explainShellCommand(arg);
      process.stdout.write(
        `${theme.brand('Explain-shell prompt')} ${theme.dim(payload.command)}\n\n${payload.prompt}\n`,
      );
      return done();
    }
    case 'generate': {
      if (!arg) {
        process.stdout.write(theme.warn('usage: /generate <goal>\n'));
        return done();
      }
      const payload = buildGeneratePrompt(arg);
      process.stdout.write(
        `${theme.brand('Generate prompt')} ${theme.dim(payload.shell)}\n\n${payload.prompt}\n`,
      );
      return done();
    }
    case 'multi': {
      const cfg = buildMultiConfig(rest);
      if ('error' in cfg) {
        process.stdout.write(theme.warn(cfg.error + '\n'));
      } else {
        process.stdout.write(
          theme.dim(`multi-model: ${cfg.models.join(', ')} (maxTokens=${cfg.maxTokens})\n`),
        );
      }
      return done();
    }
    case 'agent':
      process.stdout.write(agentCommand(rest, s.state.cwd));
      return done();
    case 'explore': {
      if (!arg) {
        process.stdout.write(exploreCommand(rest, s.state.cwd));
        return done();
      }
      process.stdout.write(theme.dim(`exploring ${s.state.cwd}\n`));
      return done(false, exploreCommand(rest, s.state.cwd));
    }
    case 'watch':
      process.stdout.write(watchCommand(rest));
      return done();
    case 'memory':
      process.stdout.write(memoryCommand(rest, s.state.cwd));
      return done();
    case 'extension':
    case 'extensions':
      process.stdout.write(extensionCommand(rest, s.state.cwd));
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

function done(consumed = true, forwardInput?: string): SlashResult {
  return { handled: true, consumed, forwardInput };
}

function renderBar(used: number, cap: number, width: number): string {
  const ratio = Math.min(1, used / cap);
  const fill = Math.round(width * ratio);
  const bar = '█'.repeat(fill) + '░'.repeat(width - fill);
  const colored = ratio > 0.9 ? theme.err(bar) : ratio > 0.75 ? theme.warn(bar) : theme.ok(bar);
  return `[${colored}]`;
}

function formatPinnedFiles(files: Array<{ path: string; tokens: number }>): string {
  if (!files.length) return `${theme.dim('No pinned files.\n')}`;
  const total = files.reduce((sum, file) => sum + file.tokens, 0);
  const lines = [
    `${theme.brand('Pinned files')}`,
    ...files.map((file, index) => `  ${index + 1}. ${file.path} ${theme.dim(`(${file.tokens} tokens)`)}`),
    `  total: ${theme.hl(String(total))} tokens`,
    '',
  ];
  return lines.join('\n');
}
