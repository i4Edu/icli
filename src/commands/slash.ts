import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { confirm, input, select } from '@inquirer/prompts';
import type { ChatCompletionMessageParam } from 'openai/resources/chat/completions';
import { config, setProvider } from '../config.js';
import { providerRegistry } from '../providers/custom-provider.js';
import { isLocalProviderName, localModelProvider } from '../providers/local-model.js';
import { Session } from '../session/session.js';
import { theme } from '../ui/theme.js';
import { showDiff, commitFromStaged, prDescription } from './git.js';
import { showChangesSinceLastTurn, showChangesSinceSessionStart } from './changes-cmd.js';
import { compactSession } from '../context/compactor.js';
import { PinnedContext } from '../context/pinned.js';
import { addReadOnly, getReadOnlyFiles, removeReadOnly } from '../context/read-only.js';
import { pickSession, exportSession } from '../session/manager.js';
import { reviewStaged, draftIssue, scaffoldBranch } from './git-extra.js';
import { indexCommand } from './index-cmd.js';
import { routeCommand } from './route-cmd.js';
import { undoCommand } from './undo-cmd.js';
import { gitUndo } from './git-undo-cmd.js';
import { costCommand } from './cost-cmd.js';
import { snippetsCommand } from './snippets-cmd.js';
import { profileCommand } from './profile-cmd.js';
import { styleCommand } from './style-cmd.js';
import { conventionsCommand } from './conventions-cmd.js';
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
import { ragCommand } from './rag-cmd.js';
import { gitLogCommand } from './git-log-cmd.js';
import { envCommand } from './env-cmd.js';
import { TodoList, todoCommand } from './todo-cmd.js';
import { tokensCommand } from './tokens-cmd.js';
import { traceCommand } from './trace-cmd.js';
import { batchCommand } from './batch-cmd.js';
import {
  getReasoningConfig,
  parseTokenBudget,
  setReasoningEffort,
  setThinkTokens,
} from './reasoning-cmd.js';
import { stashCommand } from './stash-cmd.js';
import { notifyCommand } from './notify-cmd.js';
import { buildChangelogPrompt } from './changelog-cmd.js';
import { releaseCommand } from './release-cmd.js';
import { buildFixPrompt } from './fix-cmd.js';
import { securityCommand } from './security-cmd.js';
import { formatInitResult, initProject } from './init-cmd.js';
import { templateCommand } from './template-cmd.js';
import { aliasCommand } from './alias-cmd.js';
import { MetricsCollector, metricsCommand } from './metrics-cmd.js';
import { reviewDiff } from './diff-review-cmd.js';
import { formatDiagnostics, runDiagnostics } from './doctor-cmd.js';
import { explainShellCommand } from './explain-shell-cmd.js';
import { codegenCommand } from './codegen-cmd.js';
import { buildGeneratePrompt } from './generate-cmd.js';
import { voiceCommand } from './voice-cmd.js';
import { actionsCommand } from './actions-cmd.js';
import { buildMultiConfig, formatMultiResponses } from './multi-cmd.js';
import { agentCommand } from './agent-cmd.js';
import { TDDAgent, type TDDSpec, type TDDResult } from '../agents/tdd-agent.js';
import { acpCommand } from './acp-cmd.js';
import { skillCommand } from './skill-cmd.js';
import { docCommand } from './doc-cmd.js';
import { triggerCommand as runTriggerCommand } from './trigger-cmd.js';
import { backgroundTaskManager } from '../modes/background.js';
import { runAutopilot } from '../modes/autopilot.js';
import { WorkflowEngine, type ValidationError, type WorkflowDef } from '../workflows/engine.js';
import {
  BUILTIN_WORKFLOWS,
  createWorkflowTemplate,
  getBuiltinWorkflow,
  renderWorkflowYaml,
} from '../workflows/builtins.js';
import { taskCommand } from './task-cmd.js';
import { watchCommand } from './watch-cmd.js';
import { CorrectionMemory } from '../knowledge/corrections.js';
import { memoryCommand } from './memory-cmd.js';
import { teamMemoryCommand } from './team-memory-cmd.js';
import { contextCommand } from './context-cmd.js';
import { repoCommand } from './repo-cmd.js';
import { shareCommand } from '../session/share.js';
import { CloudSession, type CloudSessionRecord } from '../session/cloud-session.js';
import {
  createHandoff,
  exportHandoffFile,
  importHandoffFile,
  previewHandoff,
  receiveHandoff,
} from '../session/handoff.js';
import { extensionCommand } from '../extensions/loader.js';
import { pluginCommand } from '../plugins/marketplace.js';
import { spaceCommand } from './space-cmd.js';
import { diagramCommand } from './diagram-cmd.js';
import { readmeCommand } from './readme-cmd.js';
import {
  getGitHubRepoSlug,
  openGitHubIssues,
  submitFeedback,
  type FeedbackType,
} from './feedback-cmd.js';
import { isModelSettingKey, resetSetting, setSetting, showSettings } from './settings-cmd.js';
import { copyContextToClipboard, copyTextToClipboard, readClipboard } from './clipboard-cmd.js';
import { resolveModePrefix, type MessageModePrefix } from './mode-prefix.js';
import { openEditor } from './editor-cmd.js';
import { fetchAndConvert, validateWebUrl } from './web-cmd.js';
import { detectAutoLintCommand, detectAutoTestCommand } from '../tools/auto-check.js';
import { ErrorWatcher, suggestFix, type ParsedError } from '../intelligence/error-watch.js';
import { DeadCodeDetector, type DeadCodeReport } from '../intelligence/dead-code.js';
import { findReferences, goToDefinition, type Location } from '../intelligence/navigation.js';
import { ContainerSandbox } from '../sandbox/container.js';
import { analyzeStackTrace, formatForLLM, parseStackTrace } from '../intelligence/stack-trace.js';
import {
  ParallelAgentRunner,
  type AgentTask,
  type AgentResult,
  type ParallelAgentRunResult,
} from '../agents/parallel-runner.js';
import {
  GoalDrivenAgent,
  type Goal,
  type GoalPlan,
  type GoalResult,
} from '../agents/goal-driven.js';
import { ProxyManager } from '../security/proxy.js';
import {
  formatFilterRules,
  formatFilterTestResult,
  loadProjectContentFilter,
  parseFilterAction,
  parseFilterPattern,
  removeProjectFilterRule,
  saveProjectFilterRule,
} from '../security/content-filter.js';
import {
  getFileTriggerManager,
  type FileTrigger,
  type FileTriggerManager,
} from '../workflows/file-trigger.js';
import { RoleManager, defaultRolesConfigPath } from '../security/roles.js';
import {
  RetentionManager,
  formatPolicies as formatRetentionPolicies,
  formatPreview as formatRetentionPreview,
  formatResult as formatRetentionResult,
  type RetentionPolicy,
  type RetentionTarget,
} from '../security/retention.js';
import { AuditLogger, auditLogPath, type AuditEntry, type AuditStats } from '../security/audit.js';
import { BridgeServer, DEFAULT_BRIDGE_PORT } from '../bridge/ide-bridge.js';
import { DEFAULT_API_PORT, getGlobalAPIServer } from '../server/api-server.js';
import { openBrowser } from '../util/browser.js';
import { assertSandbox } from '../tools/sandbox.js';
import { loadPolicy, shellCommandAllowed } from '../tools/policy.js';
import { checkCommandSafety, formatSafetyWarning } from '../tools/safety.js';
import {
  cancelSchedule,
  listScheduled,
  scheduleOnce,
  scheduleRecurring,
  setScheduleRunner,
  type ScheduledTask,
} from './schedule-cmd.js';
import { worktreeCommand } from './worktree-cmd.js';
import { exploreCommand } from './explore-cmd.js';
import { cloudRoutineCommand } from './cloud-routine-cmd.js';

export interface SlashContext {
  session: Session;
  abort: AbortController;
  metrics?: MetricsCollector;
  schedulePrompt?: (prompt: string) => void | Promise<void>;
  /** signal the outer loop to terminate */
  exit: () => void;
}

export interface SlashResult {
  handled: boolean;
  /** if true, skip sending this input to the LLM */
  consumed: boolean;
  /** optional transformed input to forward to the LLM */
  forwardInput?: string;
  /** optional per-message mode override */
  turnMode?: MessageModePrefix | null;
}

const HELP = `
${theme.brand('Slash commands')}
  /help                      show this help
  /clear, /new               wipe conversation history
  /model <name>              switch the active model (e.g. gpt-4o-mini, llama3.2)
  /provider                  show current model provider
  /provider list             list configured providers
  /provider set <name>       switch model provider (github, ollama, vllm, lmstudio, ...)
  /provider test             test the active provider connection
  /cwd <path>                change repository context
  /diff                      show git diff (unstaged, then staged)
  /changes [last]            show changes since session start or last AI turn
  /git-log                   show recent git commits
  /context [sources|budget|trim]   show visual context usage bar chart
  /usage                     show token and message usage metrics
  /pin <file>                pin a file to persistent context (or list pinned files)
  /unpin <file|--all>        remove pinned files from persistent context
  /read-only, /ro <path>     add a read-only context file
  /read-only drop <path>     remove a read-only context file
  /read-only list            list read-only context files
  /every <interval> <prompt> schedule a recurring prompt
  /after <delay> <prompt>    schedule a one-shot prompt
  /schedule                  list active scheduled prompts
  /schedule cancel <id>      cancel a scheduled prompt
  /tokens                    show detailed token usage breakdown
  /trace [show|clear|export] inspect or export reasoning trace data
  /batch <file> [flags]      run a batch prompt file with optional export
  /editor                    open $VISUAL/$EDITOR for a multi-line prompt
  /reasoning [level]         show or set reasoning effort (low|medium|high|max)
  /think-tokens [budget]     show or set reasoning token budget (8k, 0.5M, 0=off)
  /history                   browse recent conversation history
  /compact                   compress old messages, free token space
  /settings [key] [value]    show, set, or reset runtime settings
  /feedback [type] [text]    save feedback locally and optionally open issues
  /sessions                  list and resume saved sessions
  /cloud create [name]      create and connect a cloud session
  /cloud connect <id>       connect to a cloud session
  /cloud list               list cloud sessions
  /cloud destroy <id>       destroy a cloud session
  /cloud sync               sync local session state to the cloud
  /export [md|json] [path]   export current session transcript/state
  /share                     share session bundles and clipboard exports
  /paste [image]             send clipboard text or image as the next prompt
  /copy <text>               copy arbitrary text to the system clipboard
  /copy-context [last]       copy conversation context to the clipboard
  /handoff export [path]     export resumable handoff bundle
  /handoff import <path>     import a handoff bundle into a new session
  /handoff preview <path>    inspect a handoff bundle without importing
  /plan                      toggle Plan Mode
  /edit-format [whole|diff]  show or change the active edit format
  /autopilot [goal]          toggle autopilot or run a goal immediately
  /goal <description>        plan, implement, test, and verify a goal in the background
  /goal status               show the current or most recent goal run
  /goal abort                abort the active goal run
  /commit                    generate semantic commit from staged diff
  /pr                        draft PR description (branch vs default)
  /review                    review staged changes
  /diff-review [target]      review any diff (unstaged, staged, branch, range, file)
  /issue [title]             draft a GitHub issue from current context
  /branch <topic>            create a conventional feature/fix branch
  /index build|status|search workspace embeddings index
  /rag index|search|stats     manage local TF-IDF RAG index
  /search <query>            semantic search over indexed workspace code
  /goto <symbol>             find a symbol definition with regex navigation
  /refs <symbol>             find symbol references with regex navigation
  /route get|set|list        multi-model routing profile
  /undo [--hard|file|status]  undo last AI git commit or access file undo journal
  /redo                       redo approved file writes
  /cost                       estimate current session token cost
  /snippets, /snippet         manage reusable prompt snippets
  /profile, /profiles         manage saved CLI profiles
  /role [set <name>|list]     show or change the active role
  /style [learn|reset]        learn or inspect project coding style
  /conventions [subcommand]   manage project coding conventions
  /stats [show|reset|path]    show or reset local usage stats
  /audit [search|stats|export] inspect tool execution audit trail
  /explain <path>             build an explanation prompt for a file/folder
  /suggest <request>          suggest a shell command for a task
  /summary                    build a project architecture summary prompt
  /compare <file-a> <file-b>  compare two files with diff + AI prompt
  /env [--full|--check VAR]   show current environment context
  /template [name] [--apply]  scaffold a built-in project template
  /readme [preview|update]    scaffold or refresh README.md from project analysis
  /changelog [range|--last]   build a changelog prompt from git commits
  /release <type>|preview     automate version bump, changelog, tag, publish
  /fix <error>                build an AI troubleshooting prompt for an error
  /heal [--max <n>]           run build, apply safe auto-fixes, and retry
  /lint                       detect available repository linters
  /test                       detect available repository test frameworks
  /auto-lint [on|off]         toggle auto-lint after AI file edits
  /auto-test [on|off]         toggle auto-test after AI file edits
  /auto-fix [on|off]          toggle auto-repair for failed auto-checks
  /tdd <description>|status   start or inspect the latest TDD cycle
  /doctor                     diagnose local iCopilot setup
  /todo                       track session todos
  /task, /tasks               inspect background tasks
  /deps                       inspect project dependencies
  /init [--force]             create .icopilot project configuration
  /security                   scan for common secrets and credential leaks
  /proxy                      show, set, clear, or test proxy configuration
  /filter [list|add|remove|test] manage prompt content filter rules
  /retention                  inspect or enforce retention policies
  /dead-code [path]           scan for unused exports and unreachable files
  /refactor <subcommand>      build an AI refactor prompt
  /stacktrace <trace>         analyze a stack trace and diagnose root cause
  /metrics                    show session performance metrics
  /bookmark, /bookmarks       manage session rewind bookmarks
  /alias [list|set|remove]    manage custom command aliases
  /skill                      manage reusable skill sources
  /stash                      stash conversation state for later
  /notify <command>           configure Slack/Teams notifications
  /explain-shell <cmd>        explain a shell command step by step
  /generate <goal>            generate a shell command for a goal
  /actions <desc>|list|validate generate or inspect GitHub Actions workflows
  /codegen <description>      generate a module scaffold plus test file
  /multi <models> <prompt>    query multiple models in parallel
  /agent <name> [query]       build a built-in or custom agent delegation prompt
  /parallel <spec>            run multiple agent tasks concurrently
  /explore <question>         explore codebase with AI agent
  /trigger <subcommand>       manage file-change triggers
  /watch <pattern> <cmd>      file watcher configuration
  /web <url> [focus]          fetch a web page into conversation context
  /bridge <subcommand>        manage IDE bridge websocket server
  /acp [subcommand]           manage ACP (Agent Client Protocol) server
  /error-watch <action>       watch build errors and suggest fixes
  /memory                     manage persistent + auto-learned memory
  /corrections                manage remembered user corrections
  /team-memory                manage shared team memory
  /repo                       manage multi-repo orchestration
  /space                      manage project spaces
  /doc <file> [symbol]        generate docs for a file or symbol
  /diagram [type]             generate Mermaid architecture diagrams
  /extension [list|info|reload] inspect local extensions
  /serve <subcommand>         manage HTTP API server
  /worktree <subcommand>      manage git worktrees
  /cloud-routine <subcommand> manage cloud-scheduled routines
  /sandbox <run|shell|status|cleanup> use Docker sandbox helpers
  /run <command>             run a shell command and optionally add output to chat
  /voice [start|stop|status] voice input (speech-to-text, requires provider plugin)
  /plugin [subcommand]        search and manage marketplace plugins
  /workflow [subcommand]      manage workflow definitions
  /exit, /quit               quit iCopilot

${theme.brand('Session & Auth')}
  /login                     check authentication status and setup guidance
  /logout                    clear session auth token
  /user                      show current GitHub user and auth info
  /resume [id]               resume a saved session (alias for /sessions)
  /continue [id]             alias for /resume
  /rename [name]             rename the current session
  /restart                   exit and prompt to restart iCopilot

${theme.brand('Permissions & Safety')}
  /allow-all [on|off|show]   auto-approve all tool calls without prompting
  /permissions [show|reset]  view or clear in-session tool approvals
  /reset-allowed-tools       clear all tool approvals (require approval again)
  /add-dir <path>            add a directory to the trusted file-access list
  /list-dirs                 show all trusted/allowed directories
  /experimental [on|off]     toggle experimental features

${theme.brand('Research & Agents')}
  /research <topic>          deep-research a topic (codebase + web sources)
  /rubber-duck [prompt]      consult a constructive-critic second opinion
  /fleet [prompt]            run parallel subagent tasks (alias for /parallel)
  /delegate [prompt]         delegate task to autonomous execution

${theme.brand('Customisation')}
  /theme [name]              view or set colour theme (auto|light|dark|none)
  /streamer-mode             toggle streamer mode (hide sensitive details)
  /instructions              show loaded custom instruction files
  /terminal-setup            configure terminal for Shift+Enter multiline input
  /keep-alive [on|off]       prevent the machine from sleeping
  /update                    show instructions to update iCopilot to latest

${theme.brand('Info & Compat')}
  /models                    alias for /model
  /session                   show current session info (ID, model, tokens, messages)
  /skills                    alias for /skill
  /cd <path>                 alias for /cwd
  /reset                     alias for /clear
  /app                       show GitHub Copilot app / web links
  /ide                       show IDE bridge info (see /bridge)
  /lsp                       show LSP server setup guidance
  /mcp                       show MCP info (iCopilot uses ACP: /acp)
  /remote                    show remote steering info
  /chronicle <sub>           session history AI insights (standup|tips|improve)
  /clikit [component]        show current CLI config snapshot
  /downgrade <version>       show how to install a specific iCopilot version

${theme.brand('Inline')}
  /ask <message>             discuss only for one turn
  /code <message>            implement directly for one turn
  /architect <message>       plan briefly, then implement for one turn
  /reason <message>          stream reasoning, then a polished answer
  @path/to/file              inject file contents into next message
  Ctrl+X Ctrl+E              open editor for a multi-line prompt
  Ctrl-C                     interrupt streaming (does not exit)
`;

const errorWatcher = new ErrorWatcher();

interface GoalRunState {
  goal: Goal;
  plan: GoalPlan;
  agent: GoalDrivenAgent;
  startedAt: string;
  abortController: AbortController;
  promise: Promise<GoalResult>;
  result?: GoalResult;
  error?: string;
}

let activeGoalRun: GoalRunState | null = null;
let lastGoalRun: GoalRunState | null = null;
const ideBridgeServer = new BridgeServer();
const apiServer = getGlobalAPIServer();
const sandboxByCwd = new Map<string, ContainerSandbox>();
let lastTddResult: TDDResult | null = null;

const KNOWN_SLASH_COMMANDS = [
  'help',
  'clear',
  'new',
  'model',
  'provider',
  'cwd',
  'diff',
  'changes',
  'git-log',
  'context',
  'usage',
  'settings',
  'feedback',
  'pin',
  'unpin',
  'read-only',
  'ro',
  'every',
  'after',
  'schedule',
  'tokens',
  'editor',
  'reasoning',
  'think-tokens',
  'compact',
  'sessions',
  'cloud',
  'export',
  'share',
  'paste',
  'copy',
  'copy-context',
  'handoff',
  'plan',
  'edit-format',
  'autopilot',
  'goal',
  'commit',
  'pr',
  'review',
  'diff-review',
  'issue',
  'branch',
  'index',
  'rag',
  'search',
  'goto',
  'refs',
  'route',
  'undo',
  'redo',
  'cost',
  'snippets',
  'snippet',
  'profile',
  'profiles',
  'role',
  'style',
  'conventions',
  'stats',
  'audit',
  'metrics',
  'explain',
  'suggest',
  'summary',
  'compare',
  'env',
  'template',
  'readme',
  'changelog',
  'release',
  'fix',
  'heal',
  'lint',
  'test',
  'auto-lint',
  'auto-test',
  'auto-fix',
  'tdd',
  'doctor',
  'todo',
  'todos',
  'task',
  'tasks',
  'deps',
  'init',
  'security',
  'proxy',
  'filter',
  'retention',
  'dead-code',
  'refactor',
  'stacktrace',
  'bookmark',
  'bookmarks',
  'alias',
  'skill',
  'history',
  'stash',
  'notify',
  'explain-shell',
  'generate',
  'actions',
  'codegen',
  'multi',
  'agent',
  'parallel',
  'explore',
  'trigger',
  'triggers',
  'watch',
  'web',
  'bridge',
  'error-watch',
  'memory',
  'corrections',
  'team-memory',
  'repo',
  'space',
  'doc',
  'diagram',
  'extension',
  'extensions',
  'sandbox',
  'serve',
  'worktree',
  'cloud-routine',
  'voice',
  'plugin',
  'plugins',
  'workflow',
  'workflows',
  'acp',
  'exit',
  'quit',
  // ── tui.md parity additions ────────────────────────────────────────────
  'add-dir',
  'allow-all',
  'app',
  'cd',
  'chronicle',
  'clikit',
  'continue',
  'delegate',
  'downgrade',
  'experimental',
  'fleet',
  'ide',
  'instructions',
  'keep-alive',
  'caffeinate',
  'list-dirs',
  'login',
  'logout',
  'lsp',
  'mcp',
  'permissions',
  'remote',
  'rename',
  'research',
  'reset',
  'reset-allowed-tools',
  'restart',
  'resume',
  'rubber-duck',
  'session',
  'skills',
  'streamer-mode',
  'terminal-setup',
  'theme',
  'update',
  'user',
] as const;
const KNOWN_SLASH_COMMAND_SET = new Set<string>(KNOWN_SLASH_COMMANDS);
const MIN_PREFIX_LENGTH = 2;
const MAX_AMBIGUOUS_MATCHES = 6;
const MAX_SUGGESTIONS = 5;
const MAX_LEVENSHTEIN_DISTANCE = 2;

type SlashCommandResolution =
  | { kind: 'exact' | 'prefix'; command: string }
  | { kind: 'ambiguous'; matches: string[] }
  | { kind: 'unknown'; suggestions: string[] };

errorWatcher.onError((error) => {
  process.stdout.write(
    `${theme.warn(`[error-watch] ${formatParsedError(error)}`)}\n${theme.dim(`${suggestFix(error)}\n`)}\n`,
  );
});

export async function handleSlash(line: string, ctx: SlashContext): Promise<SlashResult> {
  const trimmed = line.trim();
  if (!trimmed.startsWith('/')) return { handled: false, consumed: false };

  const modePrefix = resolveModePrefix(trimmed);
  if (modePrefix.matched) {
    if (modePrefix.consumed) {
      process.stdout.write(theme.warn(`${modePrefix.usage}\n`));
      return done();
    }
    return done(false, modePrefix.forwardInput, modePrefix.turnMode ?? null);
  }

  // Tokenize: split on whitespace so "/model gpt-4o" → ["model","gpt-4o"]
  // This avoids premature character slicing that truncated commands like
  // "/model" to "/m" when multi-byte or invisible whitespace was present.
  const tokens = trimmed.slice(1).split(/\s+/);
  const cmd = tokens[0] ?? '';
  const rest = tokens.slice(1);
  const arg = rest.join(' ');
  const s = ctx.session;
  const roleManager = getRoleManager(s.state.cwd);

  // Exact aliases that bypass prefix resolution to avoid ambiguity conflicts
  const exactAliases: Record<string, string> = {
    models: 'model',
    cd: 'cwd',
    resume: 'sessions',
    continue: 'sessions',
    fleet: 'parallel',
    skills: 'skill',
    caffeinate: 'keep-alive',
    bug: 'feedback',
  };
  const resolvedAlias = exactAliases[cmd.toLowerCase()];
  const resolvedCommand = resolvedAlias
    ? ({ kind: 'exact', command: resolvedAlias } as const)
    : resolveSlashCommand(cmd);
  if (resolvedCommand.kind === 'ambiguous') {
    process.stdout.write(
      theme.warn(
        `ambiguous command: /${cmd}\nmatches: ${resolvedCommand.matches.map((value) => `/${value}`).join(', ')}\n`,
      ),
    );
    return done();
  }
  if (resolvedCommand.kind === 'unknown') {
    if (resolvedCommand.suggestions.length > 0) {
      process.stdout.write(
        theme.warn(
          `unknown command: /${cmd}\nDid you mean: ${resolvedCommand.suggestions.map((value) => `/${value}`).join(', ')}?\n(try /help)\n`,
        ),
      );
      return done();
    }
    process.stdout.write(theme.warn(`unknown command: /${cmd}  (try /help)\n`));
    return done();
  }
  const normalizedCommand = resolvedCommand.command;
  if (resolvedCommand.kind === 'prefix' && cmd.toLowerCase() !== normalizedCommand) {
    process.stdout.write(theme.dim(`↳ /${cmd} → /${normalizedCommand}\n`));
  }
  setScheduleRunner(ctx.schedulePrompt ?? null);

  if (normalizedCommand !== 'help' && normalizedCommand !== 'role') {
    const access = roleManager.checkAccess(`command:${normalizedCommand}`);
    if (!access.allowed) {
      process.stdout.write(theme.err(`${access.reason}\n`));
      return done();
    }
  }

  switch (normalizedCommand) {
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
    case 'provider': {
      if (!arg) {
        process.stdout.write(renderCurrentProvider(s.state.model));
        return done();
      }

      const [subcommand = '', ...providerArgs] = rest;
      if (subcommand === 'list') {
        process.stdout.write(renderProviderList());
        return done();
      }
      if (subcommand === 'set') {
        const target = providerArgs[0]?.trim().toLowerCase();
        if (!target) {
          process.stdout.write(theme.warn('usage: /provider set <name>\n'));
          return done();
        }
        try {
          setProvider(target);
          if (config.provider === target) {
            s.setModel(config.defaultModel);
          }
        } catch (error: any) {
          process.stdout.write(theme.err(`${error?.message || error}\n`));
          return done();
        }
        process.stdout.write(theme.ok(`✔ provider → ${config.provider} (${config.endpoint})\n`));
        return done();
      }
      if (subcommand === 'test') {
        process.stdout.write(await testActiveProvider(s.state.model));
        return done();
      }

      process.stdout.write(theme.warn('usage: /provider [list|set <name>|test]\n'));
      return done();
    }
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
    case 'changes':
      process.stdout.write(
        rest[0] === 'last'
          ? await showChangesSinceLastTurn(s)
          : await showChangesSinceSessionStart(s),
      );
      return done();
    case 'git-log':
      process.stdout.write(await gitLogCommand(rest, s.state.cwd));
      return done();
    case 'context': {
      const used = s.tokenUsage();
      const modelLimits: Record<string, number> = {
        'gpt-4o': 128000, 'gpt-4o-mini': 128000, 'gpt-4': 8192,
        'claude-sonnet': 200000, 'claude-opus': 200000, 'claude-haiku': 200000,
        'o1': 128000, 'o3': 200000,
      };
      const modelKey = Object.keys(modelLimits).find((k) => s.state.model.toLowerCase().includes(k));
      const limit = modelLimits[modelKey ?? ''] ?? 128000;
      const pct = Math.min(100, Math.round((used / limit) * 100));
      const barWidth = 40;
      const filled = Math.round((pct / 100) * barWidth);
      const bar = '█'.repeat(filled) + '░'.repeat(barWidth - filled);
      const color = pct > 90 ? '\x1b[31m' : pct > 70 ? '\x1b[33m' : '\x1b[32m';
      const reset = '\x1b[0m';
      process.stdout.write(`\n  Context Window Usage\n`);
      process.stdout.write(`  ${color}${bar}${reset}  ${pct}%\n`);
      process.stdout.write(`  ${used.toLocaleString()} / ${limit.toLocaleString()} tokens used\n`);
      process.stdout.write(`  Model: ${s.state.model}\n\n`);
      if (pct > 90) {
        process.stdout.write(`  \x1b[33m⚠ Near limit — run /compact to compress history\x1b[0m\n\n`);
      }
      return done();
    }
    case 'usage': {
      const tokenUsage = s.tokenUsage();
      const msgCount = s.state.messages?.length ?? 0;
      process.stdout.write(`\n  Usage Metrics\n`);
      process.stdout.write(`  ${'─'.repeat(40)}\n`);
      process.stdout.write(`  Tokens used:  ~${tokenUsage.toLocaleString()}\n`);
      process.stdout.write(`  Messages:     ${msgCount}\n`);
      process.stdout.write(`  Model:        ${s.state.model}\n`);
      process.stdout.write(`  ${'─'.repeat(40)}\n\n`);
      return done();
    }
    case 'settings': {
      if (!arg) {
        process.stdout.write(showSettings());
        return done();
      }
      if ((rest[0] ?? '').toLowerCase() === 'reset') {
        const key = rest[1];
        if (!key) {
          process.stdout.write(theme.warn('usage: /settings reset <key>\n'));
          return done();
        }
        try {
          process.stdout.write(resetSetting(key));
          if (isModelSettingKey(key)) s.setModel(config.defaultModel);
        } catch (error) {
          process.stdout.write(theme.err(`${(error as Error).message}\n`));
        }
        return done();
      }
      if (rest.length < 2) {
        process.stdout.write(theme.warn('usage: /settings [<key> <value> | reset <key>]\n'));
        return done();
      }
      const key = rest[0];
      const value = arg.slice(key.length).trim();
      try {
        process.stdout.write(setSetting(key, value));
        if (isModelSettingKey(key)) s.setModel(config.defaultModel);
      } catch (error) {
        process.stdout.write(theme.err(`${(error as Error).message}\n`));
      }
      return done();
    }
    case 'feedback': {
      try {
        const feedback = await resolveFeedbackInput(rest, arg);
        if (!feedback) {
          process.stdout.write(theme.warn('usage: /feedback [bug|feature|praise] <text>\n'));
          return done();
        }
        process.stdout.write(submitFeedback(feedback.type, feedback.text, { cwd: s.state.cwd }));
        const repo = getGitHubRepoSlug(s.state.cwd);
        if (repo) {
          const openIssue = await confirm({
            message: `Open GitHub issue form for ${repo}?`,
            default: false,
          }).catch(() => false);
          if (openIssue) {
            process.stdout.write(
              openGitHubIssues(repo)
                ? theme.ok(`Opened ${repo} issues in your browser.\n`)
                : theme.warn(`Could not open browser. Visit ${repo} issues manually.\n`),
            );
          }
        }
      } catch (error) {
        process.stdout.write(theme.err(`${(error as Error).message}\n`));
      }
      return done();
    }
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
      const removedFile = pinned
        .list()
        .find((file) => path.normalize(file.path) === path.normalize(target));
      if (!pinned.remove(target)) {
        process.stdout.write(theme.warn(`not pinned: ${target}\n`));
        return done();
      }

      s.setPinned(pinned.toJSON());
      process.stdout.write(theme.ok(`✔ unpinned ${target} (${removedFile?.tokens ?? 0} tokens)\n`));
      return done();
    }
    case 'read-only':
    case 'ro': {
      if (!arg || arg === 'list') {
        process.stdout.write(formatReadOnlyFiles(getReadOnlyFiles()));
        return done();
      }

      const [subcommand = '', ...subArgs] = rest;
      if (subcommand === 'drop') {
        const target = subArgs.join(' ').trim();
        if (!target) {
          process.stdout.write(theme.warn('usage: /read-only drop <path>\n'));
          return done();
        }
        const resolved = path.resolve(s.state.cwd, target);
        if (!removeReadOnly(resolved)) {
          process.stdout.write(theme.warn(`not read-only: ${resolved}\n`));
          return done();
        }
        process.stdout.write(theme.ok(`✔ removed read-only file ${resolved}\n`));
        return done();
      }

      try {
        const added = addReadOnly(arg);
        process.stdout.write(theme.ok(`✔ read-only ${added}\n`));
      } catch (error: unknown) {
        process.stdout.write(
          theme.err(`${error instanceof Error ? error.message : String(error)}\n`),
        );
      }
      return done();
    }
    case 'every': {
      const [interval = '', ...promptParts] = rest;
      const prompt = promptParts.join(' ').trim();
      if (!interval || !prompt) {
        process.stdout.write(theme.warn('usage: /every <interval> <prompt>\n'));
        return done();
      }
      try {
        const task = scheduleRecurring(interval, prompt);
        process.stdout.write(theme.ok(`✔ scheduled recurring task ${task.id} (${interval})\n`));
      } catch (error: unknown) {
        process.stdout.write(
          theme.err(`${error instanceof Error ? error.message : String(error)}\n`),
        );
      }
      return done();
    }
    case 'after': {
      const [delay = '', ...promptParts] = rest;
      const prompt = promptParts.join(' ').trim();
      if (!delay || !prompt) {
        process.stdout.write(theme.warn('usage: /after <delay> <prompt>\n'));
        return done();
      }
      try {
        const task = scheduleOnce(delay, prompt);
        process.stdout.write(theme.ok(`✔ scheduled one-shot task ${task.id} (${delay})\n`));
      } catch (error: unknown) {
        process.stdout.write(
          theme.err(`${error instanceof Error ? error.message : String(error)}\n`),
        );
      }
      return done();
    }
    case 'schedule': {
      if (rest[0] === 'cancel') {
        const id = rest.slice(1).join(' ').trim();
        if (!id) {
          process.stdout.write(theme.warn('usage: /schedule cancel <id>\n'));
          return done();
        }
        process.stdout.write(
          cancelSchedule(id)
            ? theme.ok(`✔ cancelled schedule ${id}\n`)
            : theme.warn(`schedule not found: ${id}\n`),
        );
        return done();
      }
      process.stdout.write(formatScheduledTasks(listScheduled()));
      return done();
    }
    case 'tokens':
      process.stdout.write(tokensCommand(s));
      return done();
    case 'trace':
      process.stdout.write(traceCommand(rest, s));
      return done();
    case 'batch':
      process.stdout.write(await batchCommand(rest));
      return done();
    case 'editor': {
      const content = await openEditor();
      if (!content) {
        process.stdout.write(theme.warn('editor canceled.\n'));
        return done();
      }
      return done(false, content);
    }
    case 'reasoning': {
      if (!arg) {
        process.stdout.write(formatReasoningConfig());
        return done();
      }
      const level = arg.toLowerCase();
      if (level !== 'low' && level !== 'medium' && level !== 'high' && level !== 'max') {
        process.stdout.write(theme.warn('usage: /reasoning [low|medium|high|max]\n'));
        return done();
      }
      setReasoningEffort(level);
      process.stdout.write(theme.ok(`✔ reasoning effort → ${level}\n`));
      return done();
    }
    case 'think-tokens': {
      if (!arg) {
        process.stdout.write(formatReasoningConfig());
        return done();
      }
      try {
        const budget = parseTokenBudget(arg);
        if (budget === 0) {
          setThinkTokens(null);
          process.stdout.write(theme.ok('✔ think token budget disabled\n'));
          return done();
        }
        setThinkTokens(budget);
        process.stdout.write(theme.ok(`✔ think token budget → ${budget} tokens\n`));
      } catch (error: any) {
        process.stdout.write(theme.err(`${error?.message || error}\n`));
      }
      return done();
    }
    case 'compact': {
      const msgs = s.state.messages;
      if (msgs.length < 6) {
        process.stdout.write(theme.dim('Nothing to compact (fewer than 6 messages).\n'));
        return done();
      }
      const systemMsgs = msgs.filter((m: any) => m.role === 'system');
      const nonSystem = msgs.filter((m: any) => m.role !== 'system');
      const keep = nonSystem.slice(-8);
      const removed = nonSystem.length - keep.length;

      if (removed <= 0) {
        process.stdout.write(theme.dim('Context is already compact.\n'));
        return done();
      }

      const toSummarize = nonSystem.slice(0, -8);
      let userCount = 0; let assistantCount = 0;
      for (const m of toSummarize) {
        if ((m as any).role === 'user') userCount++;
        else if ((m as any).role === 'assistant') assistantCount++;
      }

      const focusNote = arg ? ` (focus: ${arg})` : '';
      const summaryMsg = `[Conversation history compacted${focusNote}: ${userCount} user messages and ${assistantCount} assistant responses summarized]`;
      const summaryMessage = { role: 'system', content: summaryMsg };
      s.state.messages = [...systemMsgs, summaryMessage as any, ...keep];

      process.stdout.write(theme.ok(`✔ Compacted: removed ${removed} messages from history.\n`));
      process.stdout.write(theme.dim(`  ${summaryMsg}\n`));
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
    case 'cloud': {
      const cloud = new CloudSession({
        endpoint: config.endpoint,
        apiKey: config.token,
      });
      const [subcommand = '', ...subArgs] = rest;
      const action = subcommand.toLowerCase();

      if (!action) {
        process.stdout.write(formatCloudUsage(cloud.getConnectedSessionId()));
        return done();
      }

      if (action === 'create') {
        const name = subArgs.join(' ').trim() || undefined;
        const created = await cloud.create({ name });
        await cloud.sync(created.id, s);
        process.stdout.write(theme.ok(`✔ cloud session ${created.id} created and synced\n`));
        return done();
      }

      if (action === 'connect') {
        const targetId = subArgs[0]?.trim();
        if (!targetId) {
          process.stdout.write(theme.warn('usage: /cloud connect <id>\n'));
          return done();
        }
        const connected = await cloud.connect(targetId);
        process.stdout.write(theme.ok(`✔ connected cloud session ${connected.id}\n`));
        return done();
      }

      if (action === 'list') {
        process.stdout.write(formatCloudSessions(await cloud.list()));
        return done();
      }

      if (action === 'destroy') {
        const targetId = subArgs[0]?.trim();
        if (!targetId) {
          process.stdout.write(theme.warn('usage: /cloud destroy <id>\n'));
          return done();
        }
        const destroyed = await cloud.destroy(targetId);
        process.stdout.write(
          destroyed
            ? theme.ok(`✔ destroyed cloud session ${targetId}\n`)
            : theme.warn(`cloud session not found: ${targetId}\n`),
        );
        return done();
      }

      if (action === 'sync') {
        const connectedId = cloud.getConnectedSessionId();
        if (!connectedId) {
          process.stdout.write(
            theme.warn('No cloud session connected. Use /cloud create or /cloud connect <id>.\n'),
          );
          return done();
        }
        const synced = await cloud.sync(connectedId, s);
        process.stdout.write(theme.ok(`✔ synced cloud session ${synced.id}\n`));
        return done();
      }

      process.stdout.write(formatCloudUsage(cloud.getConnectedSessionId()));
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
    case 'paste': {
      try {
        if ((rest[0] ?? '').toLowerCase() === 'image') {
          const clipboard = await readClipboard();
          if (clipboard.type !== 'image') {
            process.stdout.write(theme.warn('clipboard does not contain an image\n'));
            return done();
          }
          process.stdout.write(theme.ok(`✔ pasted clipboard image ${clipboard.content}\n`));
          return done(false, `"${clipboard.content}"`);
        }

        const clipboard = await readClipboard();
        if (clipboard.type !== 'text' || !clipboard.content.trim()) {
          process.stdout.write(theme.warn('clipboard is empty, unavailable, or not text\n'));
          return done();
        }
        process.stdout.write(theme.dim('pasted clipboard text into the next prompt\n'));
        return done(false, clipboard.content);
      } catch (error: any) {
        process.stdout.write(theme.err(`clipboard: ${error?.message || error}\n`));
        return done();
      }
    }
    case 'copy': {
      if (!arg) {
        process.stdout.write(theme.warn('usage: /copy <text>\n'));
        return done();
      }
      try {
        await copyTextToClipboard(arg);
        process.stdout.write(theme.ok('✔ copied text to clipboard\n'));
      } catch (error: any) {
        process.stdout.write(theme.err(`clipboard: ${error?.message || error}\n`));
      }
      return done();
    }
    case 'copy-context': {
      try {
        const scope = (rest[0] ?? '').toLowerCase() === 'last' ? 'last' : 'all';
        const selectedMessages =
          scope === 'last' ? selectLastExchange(s.state.messages) : s.state.messages;
        const summary = buildClipboardSystemSummary(s);
        const fileContext = buildClipboardFileContext(s);
        const synthetic: ChatCompletionMessageParam[] = [];
        if (summary) synthetic.push({ role: 'system', content: summary });
        if (fileContext) synthetic.push({ role: 'system', content: fileContext });
        const messages = [...synthetic, ...selectedMessages];
        await copyContextToClipboard(messages);
        process.stdout.write(
          theme.ok(
            `✔ copied ${messages.length} context message${messages.length === 1 ? '' : 's'} to clipboard\n`,
          ),
        );
      } catch (error: any) {
        process.stdout.write(theme.err(`clipboard: ${error?.message || error}\n`));
      }
      return done();
    }
    case 'handoff': {
      const [subcommand = '', ...subArgs] = rest;
      const action = subcommand.toLowerCase();
      if (!action) {
        process.stdout.write(
          'usage: /handoff export [path]\n' +
            '       /handoff import <path>\n' +
            '       /handoff preview <path>\n',
        );
        return done();
      }

      if (action === 'export') {
        const outputPath = subArgs.join(' ').trim() || undefined;
        const bundle = createHandoff(s);
        const written = exportHandoffFile(bundle, outputPath);
        process.stdout.write(theme.ok(`✔ exported handoff ${written}\n`));
        return done();
      }

      if (action === 'preview') {
        const target = subArgs.join(' ').trim();
        if (!target) {
          process.stdout.write(theme.warn('usage: /handoff preview <path>\n'));
          return done();
        }
        const bundle = importHandoffFile(path.resolve(s.state.cwd, target));
        process.stdout.write(previewHandoff(bundle));
        return done();
      }

      if (action === 'import') {
        const target = subArgs.join(' ').trim();
        if (!target) {
          process.stdout.write(theme.warn('usage: /handoff import <path>\n'));
          return done();
        }
        const bundle = importHandoffFile(path.resolve(s.state.cwd, target));
        const imported = receiveHandoff(bundle);
        Object.assign(ctx.session, imported);
        config.cwd = imported.state.cwd;
        process.stdout.write(theme.ok(`✔ imported handoff as ${imported.state.id}\n`));
        return done();
      }

      process.stdout.write(theme.warn(`unknown handoff subcommand: ${action}\n`));
      return done();
    }
    case 'plan': {
      const next = s.state.mode === 'plan' ? 'ask' : 'plan';
      s.setMode(next);
      process.stdout.write(theme.ok(`✔ mode → ${next}\n`));
      return done();
    }
    case 'edit-format': {
      if (!arg) {
        process.stdout.write(theme.dim(`edit format: ${config.editFormat}\n`));
        return done();
      }
      if (arg !== 'whole' && arg !== 'diff') {
        process.stdout.write(theme.warn('usage: /edit-format [whole|diff]\n'));
        return done();
      }
      config.editFormat = arg;
      process.stdout.write(theme.ok(`✔ edit format → ${config.editFormat}\n`));
      return done();
    }
    case 'autopilot': {
      if (!arg) {
        const next = !s.state.autopilotEnabled;
        s.setAutopilotEnabled(next);
        process.stdout.write(theme.ok(`✔ autopilot → ${next ? 'on' : 'off'}\n`));
        return done();
      }
      await runAutopilot(arg, { session: s, signal: ctx.abort.signal });
      return done();
    }
    case 'goal': {
      const action = (rest[0] ?? '').toLowerCase();
      if (!arg) {
        process.stdout.write(
          theme.warn('usage: /goal <description> | /goal status | /goal abort\n'),
        );
        return done();
      }
      if (action === 'status') {
        process.stdout.write(formatGoalRunStatus(activeGoalRun ?? lastGoalRun));
        return done();
      }
      if (action === 'abort') {
        if (!activeGoalRun) {
          process.stdout.write(theme.warn('No active goal run.\n'));
          return done();
        }
        activeGoalRun.abortController.abort();
        process.stdout.write(theme.ok(`✔ aborting goal: ${activeGoalRun.goal.description}\n`));
        return done();
      }
      if (activeGoalRun) {
        process.stdout.write(
          theme.warn(
            `goal already running: ${activeGoalRun.goal.description} (use /goal status)\n`,
          ),
        );
        return done();
      }

      const goal: Goal = { description: arg };
      const controller = new AbortController();
      const agent = new GoalDrivenAgent({
        session: s,
        signal: controller.signal,
      });
      const plan = agent.plan(goal);
      const goalRun: GoalRunState = {
        goal,
        plan,
        agent,
        startedAt: new Date().toISOString(),
        abortController: controller,
        promise: Promise.resolve({
          goal,
          plan,
          success: false,
          attempts: 0,
          summary: '',
          aborted: false,
          stepResults: [],
          verification: {
            ok: false,
            score: 0,
            issues: [],
            attempts: 0,
          },
        }),
      };

      goalRun.promise = agent
        .execute(plan)
        .then((result) => {
          goalRun.result = result;
          lastGoalRun = goalRun;
          if (activeGoalRun === goalRun) {
            activeGoalRun = null;
          }
          process.stdout.write(`\n${formatGoalCompletion(result)}`);
          return result;
        })
        .catch((error: unknown) => {
          const message = error instanceof Error ? error.message : String(error);
          goalRun.error = message;
          const progress = agent.getProgress();
          const fallback =
            progress.result ??
            ({
              goal,
              plan,
              success: false,
              attempts: progress.currentAttempt,
              summary: message,
              aborted: progress.phase === 'aborted',
              stepResults: [],
              verification: progress.verification ?? {
                ok: false,
                score: 0,
                issues: [message],
                attempts: progress.currentAttempt,
              },
            } satisfies GoalResult);
          goalRun.result = fallback;
          lastGoalRun = goalRun;
          if (activeGoalRun === goalRun) {
            activeGoalRun = null;
          }
          process.stdout.write(theme.err(`\ngoal failed: ${message}\n`));
          return fallback;
        });

      activeGoalRun = goalRun;
      lastGoalRun = goalRun;
      process.stdout.write(
        theme.ok(
          `✔ goal started (${plan.steps.length} steps, ~${plan.estimatedTokens} tokens). Use /goal status or /goal abort.\n`,
        ),
      );
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
    case 'rag':
      process.stdout.write(await ragCommand(rest, s.state.cwd));
      return done();
    case 'search':
      process.stdout.write(await searchCommand(rest, s.state.cwd));
      return done();
    case 'goto': {
      if (!arg) {
        process.stdout.write(theme.warn('usage: /goto <symbol>\n'));
        return done();
      }
      const definition = goToDefinition(arg, s.state.cwd);
      if (!definition) {
        process.stdout.write(theme.warn(`definition not found: ${arg}\n`));
        return done();
      }
      process.stdout.write(formatNavigationResult('Definition', arg, [definition]));
      return done();
    }
    case 'refs': {
      if (!arg) {
        process.stdout.write(theme.warn('usage: /refs <symbol>\n'));
        return done();
      }
      const references = findReferences(arg, s.state.cwd);
      if (references.length === 0) {
        process.stdout.write(theme.warn(`no references found: ${arg}\n`));
        return done();
      }
      process.stdout.write(formatNavigationResult('References', arg, references));
      return done();
    }
    case 'route':
      process.stdout.write(routeCommand(arg));
      return done();
    case 'undo':
      if (rest[0]?.toLowerCase() === 'status') {
        process.stdout.write(await undoCommand('status'));
        return done();
      }
      if (rest[0]?.toLowerCase() === 'file' || rest[0]?.toLowerCase() === 'journal') {
        process.stdout.write(await undoCommand('undo'));
        return done();
      }
      process.stdout.write(await gitUndo({ cwd: s.state.cwd, hard: rest.includes('--hard') }));
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
    case 'role':
      process.stdout.write(handleRoleCommand(rest, roleManager));
      return done();
    case 'style':
      process.stdout.write(await styleCommand(rest, s.state.cwd));
      return done();
    case 'conventions':
      process.stdout.write(conventionsCommand(rest, s.state.cwd));
      return done();
    case 'stats':
      process.stdout.write(statsCommand(arg || undefined));
      return done();
    case 'audit': {
      const audit = new AuditLogger();
      const [subcommand = '', ...subArgs] = rest;
      const action = subcommand.toLowerCase();
      if (!action) {
        process.stdout.write(formatAuditEntries(audit.getRecent()));
        return done();
      }
      if (action === 'search') {
        const query = subArgs.join(' ').trim();
        if (!query) {
          process.stdout.write(theme.warn('usage: /audit search <query>\n'));
          return done();
        }
        const matches = searchAuditEntries(audit.query(), query);
        process.stdout.write(
          formatAuditEntries(matches.slice(-20).reverse(), `Audit search: ${query}`),
        );
        return done();
      }
      if (action === 'stats') {
        process.stdout.write(formatAuditStats(audit.getStats()));
        return done();
      }
      if (action === 'export') {
        const requested = subArgs.join(' ').trim();
        const target = requested
          ? path.resolve(s.state.cwd, requested)
          : path.join(s.state.cwd, 'audit-export.log');
        const format = target.toLowerCase().endsWith('.json') ? 'json' : 'jsonl';
        const written = audit.export(target, format);
        process.stdout.write(theme.ok(`✔ exported audit log ${written}\n`));
        return done();
      }
      process.stdout.write(
        [
          theme.warn('usage: /audit'),
          '       /audit search <query>',
          '       /audit stats',
          '       /audit export [path]',
          `       log: ${auditLogPath()}`,
          '',
        ].join('\n'),
      );
      return done();
    }
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
    case 'readme':
      process.stdout.write(readmeCommand(rest, s.state.cwd));
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
    case 'release':
      process.stdout.write(await releaseCommand(rest, s.state.cwd));
      return done();
    case 'fix': {
      const payload = buildFixPrompt(arg);
      process.stdout.write(`${theme.brand('Fix prompt')}\n\n${payload.prompt}\n`);
      return done();
    }
    case 'heal': {
      const parsed = parseHealArgs(rest);
      if ('error' in parsed) {
        process.stdout.write(theme.warn(`${parsed.error}\n`));
        return done();
      }

      const { SelfHealingBuilder } = await import('../agents/self-heal.js');
      const builder = new SelfHealingBuilder(s.state.cwd);
      process.stdout.write(theme.dim(`healing build in ${s.state.cwd}\n`));
      const result = await builder.healAndRetry(parsed.maxAttempts);
      process.stdout.write(formatHealResult(result));
      return done();
    }
    case 'lint':
      process.stdout.write(lintCommand(s.state.cwd));
      return done();
    case 'test':
      process.stdout.write(testCommand(s.state.cwd));
      return done();
    case 'auto-lint': {
      const next = resolveToggle(arg, config.autoLint);
      if (next === undefined) {
        process.stdout.write(theme.warn('usage: /auto-lint [on|off]\n'));
        return done();
      }
      config.autoLint = next;
      const detected = detectAutoLintCommand(s.state.cwd);
      process.stdout.write(
        theme.ok(
          `✔ auto-lint → ${next ? 'on' : 'off'}${next && detected ? ` (${detected})` : ''}\n`,
        ),
      );
      return done();
    }
    case 'auto-test': {
      const next = resolveToggle(arg, config.autoTest);
      if (next === undefined) {
        process.stdout.write(theme.warn('usage: /auto-test [on|off]\n'));
        return done();
      }
      config.autoTest = next;
      const detected = detectAutoTestCommand(s.state.cwd);
      process.stdout.write(
        theme.ok(
          `✔ auto-test → ${next ? 'on' : 'off'}${next && detected ? ` (${detected})` : ''}\n`,
        ),
      );
      return done();
    }
    case 'auto-fix': {
      const next = resolveToggle(arg, config.autoFix);
      if (next === undefined) {
        process.stdout.write(theme.warn('usage: /auto-fix [on|off]\n'));
        return done();
      }
      config.autoFix = next;
      process.stdout.write(theme.ok(`✔ auto-fix → ${next ? 'on' : 'off'}\n`));
      return done();
    }
    case 'tdd':
      if (!arg) {
        process.stdout.write(theme.warn('usage: /tdd <description>\n       /tdd status\n'));
        return done();
      }
      if (arg.toLowerCase() === 'status') {
        process.stdout.write(formatTddStatus(lastTddResult));
        return done();
      }
      lastTddResult = new TDDAgent(s.state.cwd).fullCycle(buildTddSpec(arg));
      process.stdout.write(formatTddCycle(lastTddResult));
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
    case 'proxy':
      process.stdout.write(await proxyCommand(rest));
      return done();
    case 'filter':
      process.stdout.write(handleFilterSlashCommand(s.state.cwd, arg, rest));
      return done();
    case 'retention':
      process.stdout.write(retentionCommand(rest));
      return done();
    case 'dead-code': {
      const scanRoot = arg ? path.resolve(s.state.cwd, arg) : s.state.cwd;
      const report = new DeadCodeDetector().scan(scanRoot);
      process.stdout.write(formatDeadCodeReport(scanRoot, report));
      return done();
    }
    case 'refactor':
      process.stdout.write(refactorCommand(rest, s.state.cwd));
      return done();
    case 'stacktrace': {
      if (!arg) {
        process.stdout.write(theme.warn('usage: /stacktrace <stack-trace text>\n'));
        return done();
      }
      const trace = parseStackTrace(arg);
      const analysis = analyzeStackTrace(trace);
      process.stdout.write(formatStackTraceSummary(trace, analysis));
      const prompt = [
        'You are diagnosing a stack trace for a developer.',
        'Use the structured analysis first, then the raw trace.',
        'Explain the most likely root cause, identify the best user-code frame to inspect next, and suggest 2-3 fixes ranked by likelihood.',
        'Keep the answer practical and specific to the failing code path.',
        '',
        `Error type: ${trace.type}`,
        `Error message: ${trace.error}`,
        '',
        formatForLLM(analysis),
        '',
        'Raw stack trace:',
        trace.raw,
      ].join('\n');
      return done(false, prompt);
    }
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
    case 'notify': {
      const output = await notifyCommand(rest);
      if (output) {
        process.stdout.write(`${output}\n`);
      }
      return done();
    }
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
    case 'actions':
      process.stdout.write(actionsCommand(rest, s.state.cwd));
      return done();
    case 'codegen':
      process.stdout.write(codegenCommand(rest, s.state.cwd));
      return done();
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
    case 'parallel': {
      const spec = parseParallelSpec(arg);
      if ('error' in spec) {
        process.stdout.write(theme.warn(`${spec.error}\n`));
        return done();
      }

      const runner = new ParallelAgentRunner({
        model: s.state.model,
        concurrencyLimit: spec.concurrencyLimit,
        timeoutMs: spec.timeoutMs,
        onProgress: (event) => {
          if (event.status === 'started') {
            process.stdout.write(
              theme.dim(
                `→ ${event.name} [${String(event.type)}] ${event.completed}/${event.total}\n`,
              ),
            );
            return;
          }
          if (event.status === 'success' || event.status === 'error') {
            const marker = event.status === 'success' ? theme.ok('✔') : theme.err('✖');
            const duration = event.result ? formatDuration(event.result.duration) : '0ms';
            process.stdout.write(`${marker} ${event.name} ${theme.dim(`(${duration})`)}\n`);
          }
        },
      });

      process.stdout.write(
        theme.dim(
          `running ${spec.agents.length} parallel agent${spec.agents.length === 1 ? '' : 's'} ` +
            `(concurrency=${runner.concurrencyLimit}, timeout=${runner.timeoutMs}ms)\n`,
        ),
      );
      const result = await runner.runParallel(spec.agents);
      process.stdout.write(formatParallelResults(result));
      return done();
    }
    case 'explore': {
      if (!arg) {
        process.stdout.write(exploreCommand(rest, s.state.cwd));
        return done();
      }
      process.stdout.write(theme.dim(`exploring ${s.state.cwd}\n`));
      return done(false, exploreCommand(rest, s.state.cwd));
    }
    case 'trigger':
    case 'triggers':
      process.stdout.write(await runTriggerCommand(rest, s.state.cwd));
      return done();
    case 'watch':
      process.stdout.write(watchCommand(rest));
      return done();
    case 'web': {
      const [rawUrl] = rest;
      const focus = rawUrl ? arg.slice(rawUrl.length).trim() : '';
      if (!rawUrl) {
        process.stdout.write(theme.warn('usage: /web <url> [focus instructions]\n'));
        return done();
      }

      try {
        const parsedUrl = validateWebUrl(rawUrl);
        const result = await fetchAndConvert(parsedUrl.toString());
        const bytes = Buffer.byteLength(result.markdown, 'utf8');
        const content = buildWebContextMessage(parsedUrl.toString(), result.markdown, focus);
        s.push({ role: 'user', content });
        process.stdout.write(
          [
            `${theme.brand('Web context added')} ${theme.dim(parsedUrl.toString())}`,
            `  title:  ${result.title}`,
            `  bytes:  ${bytes}`,
            `  tokens: ${result.tokens}`,
            focus ? `  focus:  ${focus}` : '',
            '',
          ]
            .filter(Boolean)
            .join('\n'),
        );
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        process.stdout.write(theme.err(`${message}\n`));
      }
      return done();
    }
    case 'bridge':
      process.stdout.write(await bridgeCommand(rest));
      return done();
    case 'error-watch':
      process.stdout.write(errorWatchCommand(rest));
      return done();
    case 'memory':
      process.stdout.write(memoryCommand(rest, s.state.cwd));
      return done();
    case 'corrections':
      process.stdout.write(correctionsCommand(rest));
      return done();
    case 'team-memory':
      process.stdout.write(teamMemoryCommand(rest, s.state.cwd));
      return done();
    case 'repo':
      process.stdout.write(
        await repoCommand(rest, {
          cwd: s.state.cwd,
          onSwitch: (repo) => {
            config.cwd = repo.path;
            s.setCwd(repo.path);
          },
        }),
      );
      return done();
    case 'space':
      process.stdout.write(
        spaceCommand(rest, {
          cwd: s.state.cwd,
          onSwitch: (space) => {
            config.cwd = space.rootPath;
            s.setCwd(space.rootPath);
            if (space.config.model) {
              s.setModel(space.config.model);
            }
            s.setSystemPrompt(space.config.systemPrompt);
          },
        }),
      );
      return done();
    case 'doc':
      process.stdout.write(docCommand(rest, s.state.cwd));
      return done();
    case 'diagram':
      process.stdout.write(diagramCommand(rest, s.state.cwd));
      return done();
    case 'extension':
    case 'extensions':
      process.stdout.write(extensionCommand(rest, s.state.cwd));
      return done();
    case 'sandbox':
      process.stdout.write(await sandboxCommand(rest, s.state.cwd));
      return done();
    case 'serve':
      process.stdout.write(await serveCommand(rest));
      return done();
    case 'worktree':
      process.stdout.write(worktreeCommand(rest, s.state.cwd));
      return done();
    case 'cloud-routine':
      process.stdout.write(await cloudRoutineCommand(arg));
      return done();
    case 'voice':
      process.stdout.write(await voiceCommand(rest));
      return done();
    case 'plugin':
    case 'plugins':
      process.stdout.write(await pluginCommand(rest));
      return done();
    case 'workflow':
    case 'workflows':
      process.stdout.write(await workflowCommand(rest, s.state.cwd));
      return done();
    case 'acp':
      process.stdout.write(await acpCommand({ subcommand: rest[0], args: rest.slice(1) }));
      return done();
    case 'exit':
    case 'quit':
      ctx.exit();
      return done();

    // ── tui.md parity: aliases ──────────────────────────────────────────────
    case 'cd':
      // alias for cwd — fall through after rewriting tokens
      tokens[0] = 'cwd';
      // handled below via fallthrough — but switch already consumed, so handle inline
      if (arg) {
        try {
          process.chdir(arg);
          s.state.cwd = process.cwd();
          process.stdout.write(theme.ok(`cwd: ${process.cwd()}\n`));
        } catch (e: any) {
          process.stdout.write(theme.err(`cannot cd: ${e?.message}\n`));
        }
      } else {
        process.stdout.write(theme.ok(`cwd: ${s.state.cwd}\n`));
      }
      return done();
    case 'models':
      process.stdout.write(theme.dim('→ /model (alias)\n'));
      process.stdout.write(theme.ok(`current model: ${config.defaultModel}\n`));
      process.stdout.write(theme.dim('Usage: /model <name>  to switch\n'));
      return done();
    case 'reset':
      s.reset();
      process.stdout.write(theme.ok('conversation history cleared.\n'));
      return done();
    case 'resume':
    case 'continue':
      return done(false, '/sessions');
    case 'session': {
      const tokenUsage = s.tokenUsage();
      const msgCount = s.state.messages?.length ?? 0;
      const userMsgs = s.state.messages?.filter((m: any) => m.role === 'user').length ?? 0;
      process.stdout.write(`\n  Session Info\n`);
      process.stdout.write(`  ${'─'.repeat(40)}\n`);
      process.stdout.write(`  ID:        ${s.state.id || 'unknown'}\n`);
      process.stdout.write(`  Model:     ${s.state.model}\n`);
      process.stdout.write(`  Mode:      ${s.state.mode || 'ask'}\n`);
      process.stdout.write(`  CWD:       ${s.state.cwd}\n`);
      process.stdout.write(`  Messages:  ${msgCount} total, ${userMsgs} from you\n`);
      process.stdout.write(`  Tokens:    ~${tokenUsage.toLocaleString()}\n`);
      process.stdout.write(`  ${'─'.repeat(40)}\n\n`);
      return done();
    }
    case 'skills':
      process.stdout.write(theme.dim('→ /skill (alias)\n'));
      // forward to skill handler
      return done(false, '/skill ' + arg);
    case 'fleet':
      process.stdout.write(theme.dim('→ /parallel (alias)\n'));
      if (!arg) {
        process.stdout.write(theme.warn('usage: /fleet <prompt>  — runs parallel subagent tasks\n'));
        return done();
      }
      return done(false, '/parallel ' + arg);

    // ── tui.md parity: auth ─────────────────────────────────────────────────
    case 'login': {
      const tok = process.env.GITHUB_TOKEN || process.env.GH_TOKEN ||
                  process.env.ICOPILOT_TOKEN || config.token;
      if (tok) {
        process.stdout.write(theme.ok(`✔ Authenticated — token set (${tok.slice(0, 8)}…)\n`));
        process.stdout.write(theme.dim(`  provider: ${config.provider}\n`));
        process.stdout.write(theme.dim(`  model:    ${config.defaultModel}\n`));
      } else {
        process.stdout.write(theme.warn('Not authenticated. Options:\n'));
        process.stdout.write(theme.dim('  1. export GITHUB_TOKEN=<token>\n'));
        process.stdout.write(theme.dim('  2. export GH_TOKEN=<token>  (GitHub CLI token)\n'));
        process.stdout.write(theme.dim('  3. export ICOPILOT_TOKEN=<token>\n'));
        process.stdout.write(theme.dim('  4. Run: gh auth login\n'));
        process.stdout.write(theme.dim('  5. Add token to ~/.icopilotrc.json\n'));
        process.stdout.write(theme.dim('  Fine-grained PAT needs "Copilot Requests" permission.\n'));
      }
      return done();
    }
    case 'logout':
      config.token = undefined;
      process.stdout.write(theme.ok('Token cleared for this session.\n'));
      process.stdout.write(theme.dim('Note: env vars (GITHUB_TOKEN, GH_TOKEN) are not affected.\n'));
      return done();
    case 'user': {
      const utok = process.env.GITHUB_TOKEN || process.env.GH_TOKEN ||
                   process.env.ICOPILOT_TOKEN || config.token;
      if (!utok) {
        process.stdout.write(theme.warn('Not authenticated. Run /login for setup.\n'));
        return done();
      }
      process.stdout.write(theme.ok('GitHub user info:\n'));
      process.stdout.write(theme.dim(`  token:    ${utok.slice(0, 8)}… (${utok.length} chars)\n`));
      process.stdout.write(theme.dim(`  provider: ${config.provider}\n`));
      process.stdout.write(theme.dim(`  model:    ${config.defaultModel}\n`));
      process.stdout.write(theme.dim('  profile:  https://github.com/settings/profile\n'));
      return done();
    }

    // ── tui.md parity: permissions & safety ────────────────────────────────
    case 'allow-all': {
      const aaSub = rest[0]?.toLowerCase();
      if (!aaSub || aaSub === 'show') {
        process.stdout.write(theme.ok(`allow-all: ${config.autoApprove ? 'ON' : 'OFF'}\n`));
      } else if (aaSub === 'on' || aaSub === 'off') {
        config.autoApprove = aaSub === 'on';
        process.stdout.write(
          theme.ok(`allow-all ${config.autoApprove ? 'enabled' : 'disabled'} — tools will ${config.autoApprove ? 'auto-approve' : 'require approval'}\n`),
        );
      } else {
        process.stdout.write(theme.warn('usage: /allow-all [on|off|show]\n'));
      }
      return done();
    }
    case 'permissions': {
      const pSub = rest[0]?.toLowerCase();
      if (!pSub || pSub === 'show') {
        process.stdout.write(theme.ok('Current permissions:\n'));
        process.stdout.write(theme.dim(`  auto-approve all:  ${config.autoApprove ? 'yes' : 'no'}\n`));
        process.stdout.write(theme.dim(`  auto-fix enabled:  ${config.autoFix ? 'yes' : 'no'}\n`));
        process.stdout.write(theme.dim(`  sandbox mode:      ${config.sandbox ? 'yes' : 'no'}\n`));
        process.stdout.write(theme.dim('\n  /permissions reset  to clear approvals\n'));
      } else if (pSub === 'reset') {
        config.autoApprove = false;
        process.stdout.write(theme.ok('Tool approvals cleared — all tools require approval again.\n'));
      } else {
        process.stdout.write(theme.warn('usage: /permissions [show|reset]\n'));
      }
      return done();
    }
    case 'reset-allowed-tools':
      config.autoApprove = false;
      process.stdout.write(theme.ok('All tool approvals cleared.\n'));
      return done();
    case 'add-dir': {
      if (!arg) {
        process.stdout.write(theme.warn('usage: /add-dir <path>\n'));
        return done();
      }
      const addedPath = path.resolve(s.state.cwd, arg);
      const cfgAny = config as any;
      if (!Array.isArray(cfgAny.trustedDirs)) cfgAny.trustedDirs = [];
      if (!cfgAny.trustedDirs.includes(addedPath)) cfgAny.trustedDirs.push(addedPath);
      process.stdout.write(theme.ok(`✔ Trusted directory added: ${addedPath}\n`));
      return done();
    }
    case 'list-dirs': {
      const cfgAny2 = config as any;
      const dirs = [s.state.cwd, ...(cfgAny2.trustedDirs ?? [])];
      process.stdout.write(theme.ok('Allowed directories:\n'));
      for (const d of dirs) process.stdout.write(theme.dim(`  ${d}\n`));
      return done();
    }

    // ── tui.md parity: session management ──────────────────────────────────
    case 'rename': {
      const newName = arg || `session-${new Date().toISOString().slice(0, 10)}-${s.state.id.slice(0, 6)}`;
      (s.state as any).name = newName;
      process.stdout.write(theme.ok(`Session renamed: ${newName}\n`));
      return done();
    }
    case 'restart':
      process.stdout.write(theme.ok('Exiting… run `icopilot` to start a fresh session.\n'));
      ctx.exit();
      return done();

    // ── tui.md parity: customisation ───────────────────────────────────────
    case 'experimental': {
      const expSub = rest[0]?.toLowerCase();
      const expCfg = config as any;
      if (!expSub || expSub === 'show') {
        const on = Boolean(expCfg.experimental);
        process.stdout.write(theme.ok(`experimental features: ${on ? 'ON' : 'OFF'}\n`));
        process.stdout.write(theme.dim('  • autopilot mode (Shift+Tab)\n'));
        process.stdout.write(theme.dim('  • /after and /every scheduling\n'));
        process.stdout.write(theme.dim('  • /ask side-questions\n'));
        if (!on) process.stdout.write(theme.dim('\n  Enable: /experimental on\n'));
      } else if (expSub === 'on' || expSub === 'off') {
        expCfg.experimental = expSub === 'on';
        process.stdout.write(theme.ok(`Experimental features ${expSub === 'on' ? 'enabled' : 'disabled'}.\n`));
      } else {
        process.stdout.write(theme.warn('usage: /experimental [on|off|show]\n'));
      }
      return done();
    }
    case 'theme': {
      const validThemes = ['auto', 'light', 'dark', 'none'];
      const tSub = rest[0]?.toLowerCase();
      if (!tSub) {
        process.stdout.write(theme.ok(`current theme: ${config.theme}\n`));
        process.stdout.write(theme.dim(`available:     ${validThemes.join(' | ')}\n`));
        process.stdout.write(theme.dim('usage: /theme <name>\n'));
      } else if (validThemes.includes(tSub)) {
        config.theme = tSub as any;
        process.stdout.write(theme.ok(`Theme set to: ${tSub}\n`));
      } else {
        process.stdout.write(theme.warn(`Unknown theme: ${tSub}\navailable: ${validThemes.join(', ')}\n`));
      }
      return done();
    }
    case 'streamer-mode':
      config.quiet = !config.quiet;
      process.stdout.write(
        theme.ok(`Streamer mode ${config.quiet ? 'ON' : 'OFF'} — sensitive info ${config.quiet ? 'hidden' : 'shown'}.\n`),
      );
      return done();
    case 'instructions': {
      const instrFiles = [
        path.join(s.state.cwd, 'AGENTS.md'),
        path.join(s.state.cwd, 'CLAUDE.md'),
        path.join(s.state.cwd, 'GEMINI.md'),
        path.join(s.state.cwd, '.github', 'copilot-instructions.md'),
        path.join(s.state.cwd, '.github', 'copilot-instructions.md'),
        path.join(os.homedir(), '.icopilot', 'instructions.md'),
      ];
      process.stdout.write(theme.ok('Custom instruction files:\n'));
      let found = 0;
      for (const f of instrFiles) {
        if (fs.existsSync(f)) {
          const sz = fs.statSync(f).size;
          process.stdout.write(theme.dim(`  ✔ ${f} (${sz}B)\n`));
          found++;
        }
      }
      if (found === 0) {
        process.stdout.write(theme.dim('  No instruction files found.\n'));
        process.stdout.write(theme.dim('  Create .github/copilot-instructions.md or AGENTS.md to add instructions.\n'));
      }
      return done();
    }
    case 'keep-alive':
    case 'caffeinate': {
      const kaSub = rest[0]?.toLowerCase();
      const kaCfg = config as any;
      if (kaSub === 'off') {
        if (kaCfg._keepAliveTimer) { clearInterval(kaCfg._keepAliveTimer); kaCfg._keepAliveTimer = null; }
        kaCfg._keepAlive = false;
        process.stdout.write(theme.ok('keep-alive disabled.\n'));
      } else {
        if (kaCfg._keepAliveTimer) clearInterval(kaCfg._keepAliveTimer);
        kaCfg._keepAliveTimer = setInterval(() => { /* keep Node.js event loop alive */ }, 60_000);
        kaCfg._keepAlive = true;
        process.stdout.write(theme.ok(`keep-alive ON — session will not sleep.\n`));
        process.stdout.write(theme.dim('  /keep-alive off  to disable\n'));
      }
      return done();
    }
    case 'terminal-setup':
      process.stdout.write(theme.ok('Terminal Setup for Multi-line Input (Shift+Enter):\n\n'));
      process.stdout.write(theme.dim('  Warp / Ghostty / Kitty:\n'));
      process.stdout.write(theme.dim('    Shift+Enter works automatically.\n\n'));
      process.stdout.write(theme.dim('  iTerm2 (macOS):\n'));
      process.stdout.write(theme.dim('    Preferences → Keys → Key Bindings → +\n'));
      process.stdout.write(theme.dim('    Keyboard shortcut: Shift+Return\n'));
      process.stdout.write(theme.dim('    Action: Send Escape Sequence → [13;2u\n\n'));
      process.stdout.write(theme.dim('  VS Code Integrated Terminal:\n'));
      process.stdout.write(theme.dim('    Add to keybindings.json:\n'));
      process.stdout.write(theme.dim('    { "key": "shift+enter",\n'));
      process.stdout.write(theme.dim('      "command": "workbench.action.terminal.sendSequence",\n'));
      process.stdout.write(theme.dim('      "args": { "text": "\\u001b[13;2u" } }\n\n'));
      process.stdout.write(theme.dim('  The iCopilot TUI handles Shift+Enter natively.\n'));
      return done();
    case 'update':
      process.stdout.write(theme.ok('Update iCopilot to the latest version:\n\n'));
      process.stdout.write(theme.dim('  npm:      npm install -g icopilot@latest\n'));
      process.stdout.write(theme.dim('  check:    npm view icopilot version\n'));
      process.stdout.write(theme.dim('  current:  '));
      try {
        const { createRequire } = await import('node:module');
        const _r = createRequire(import.meta.url);
        const pkg = _r('../../package.json') as { version: string };
        process.stdout.write(`v${pkg.version}\n`);
      } catch {
        process.stdout.write('(unknown)\n');
      }
      return done();

    // ── tui.md parity: research & agents ───────────────────────────────────
    case 'research':
      if (!arg) {
        process.stdout.write(theme.warn('usage: /research <topic>\n'));
        process.stdout.write(theme.dim('  Deep-researches a topic using codebase analysis and knowledge.\n'));
        process.stdout.write(theme.dim('  Tip: /explore is similar for codebase-specific exploration.\n'));
        return done();
      }
      return done(
        false,
        `Research deeply: ${arg}. Search the codebase, analyze patterns, examine relevant files, and produce a comprehensive report with findings, citations, and actionable recommendations.`,
      );
    case 'rubber-duck': {
      const rdPrompt = arg || 'Review my last approach and provide a second opinion.';
      return done(
        false,
        `[Rubber Duck] Act as a constructive critic. ${rdPrompt} Challenge assumptions, identify potential edge cases or bugs, and suggest improvements — be honest but constructive.`,
      );
    }
    case 'delegate':
      if (!arg) {
        process.stdout.write(theme.warn('usage: /delegate <prompt>\n'));
        process.stdout.write(theme.dim('  Delegates a task to autonomous execution (similar to /autopilot).\n'));
        return done();
      }
      return done(false, arg);
    case 'chronicle': {
      const chSub = (rest[0] ?? 'standup').toLowerCase();
      if (chSub === 'standup') {
        return done(false, 'Generate a brief standup report for what we accomplished in this session: completed tasks, in-progress items, blockers, and next steps.');
      } else if (chSub === 'tips') {
        return done(false, 'Based on this session, give me 3–5 specific actionable tips to improve my workflow or codebase quality.');
      } else if (chSub === 'improve') {
        return done(false, 'Analyze this session and suggest specific improvements to code quality, architecture, and processes we worked on.');
      } else {
        process.stdout.write(theme.ok('chronicle subcommands: standup | tips | improve\n'));
      }
      return done();
    }

    // ── tui.md parity: info & compat stubs ─────────────────────────────────
    case 'app':
      process.stdout.write(theme.ok('GitHub Copilot resources:\n'));
      process.stdout.write(theme.dim('  Web:       https://github.com/features/copilot\n'));
      process.stdout.write(theme.dim('  Docs:      https://docs.github.com/copilot\n'));
      process.stdout.write(theme.dim('  VS Code:   "GitHub Copilot" extension in marketplace\n'));
      process.stdout.write(theme.dim('  JetBrains: "GitHub Copilot" plugin\n'));
      return done();
    case 'ide':
      process.stdout.write(theme.ok('IDE Integration:\n'));
      process.stdout.write(theme.dim('  Use /bridge to manage the IDE bridge WebSocket server.\n'));
      process.stdout.write(theme.dim('  Run: /bridge start  to enable IDE connectivity.\n'));
      return done();
    case 'lsp':
      process.stdout.write(theme.ok('Language Server Protocol (LSP) setup:\n'));
      process.stdout.write(theme.dim('  Install language servers separately, then configure in ~/.icopilotrc.json.\n\n'));
      process.stdout.write(theme.dim('  TypeScript:  npm install -g typescript-language-server\n'));
      process.stdout.write(theme.dim('  Python:      pip install python-lsp-server\n'));
      process.stdout.write(theme.dim('  Rust:        rustup component add rust-analyzer\n'));
      process.stdout.write(theme.dim('  Go:          go install golang.org/x/tools/gopls@latest\n'));
      return done();
    case 'mcp':
      process.stdout.write(theme.ok('Model Context Protocol (MCP):\n'));
      process.stdout.write(theme.dim('  iCopilot uses ACP (Agent Client Protocol) for tool extensions.\n'));
      process.stdout.write(theme.dim('  Use /acp to manage ACP server configuration.\n'));
      process.stdout.write(theme.dim('  Run: /acp start  to launch the ACP server.\n'));
      return done();
    case 'remote':
      process.stdout.write(theme.ok('Remote steering:\n'));
      process.stdout.write(theme.dim('  Remote session steering is not available in iCopilot.\n'));
      process.stdout.write(theme.dim('  Use /serve to start the HTTP API server for external access.\n'));
      return done();
    case 'clikit':
      process.stdout.write(theme.ok('CLI Config Snapshot:\n'));
      process.stdout.write(theme.dim(`  theme:      ${config.theme}\n`));
      process.stdout.write(theme.dim(`  provider:   ${config.provider}\n`));
      process.stdout.write(theme.dim(`  model:      ${config.defaultModel}\n`));
      process.stdout.write(theme.dim(`  editFormat: ${config.editFormat}\n`));
      process.stdout.write(theme.dim(`  quiet:      ${config.quiet}\n`));
      process.stdout.write(theme.dim(`  sandbox:    ${config.sandbox}\n`));
      process.stdout.write(theme.dim(`  autoApprove:${config.autoApprove}\n`));
      process.stdout.write(theme.dim(`  token:      ${config.token ? config.token.slice(0, 8) + '…' : 'not set'}\n`));
      return done();
    case 'downgrade':
      if (!arg) {
        process.stdout.write(theme.warn('usage: /downgrade <version>\n'));
        return done();
      }
      process.stdout.write(theme.ok(`Install icopilot v${arg}:\n`));
      process.stdout.write(theme.dim(`  npm install -g icopilot@${arg}\n`));
      return done();
    default:
      process.stdout.write(theme.warn(`unknown command: /${cmd}  (try /help)\n`));
      return done();
  }
}

function resolveSlashCommand(rawCommand: string): SlashCommandResolution {
  const command = rawCommand.trim().toLowerCase();
  if (!command) return { kind: 'unknown', suggestions: [] };
  if (KNOWN_SLASH_COMMAND_SET.has(command)) {
    return { kind: 'exact', command };
  }
  if (command.length >= MIN_PREFIX_LENGTH) {
    const prefixMatches = KNOWN_SLASH_COMMANDS.filter((known) => known.startsWith(command));
    if (prefixMatches.length === 1) return { kind: 'prefix', command: prefixMatches[0] };
    if (prefixMatches.length > 1) {
      return { kind: 'ambiguous', matches: prefixMatches.slice(0, MAX_AMBIGUOUS_MATCHES) };
    }
  }
  return { kind: 'unknown', suggestions: suggestSlashCommands(command) };
}

function suggestSlashCommands(command: string): string[] {
  if (!command) return [];
  const exactPrefix: string[] = [];
  const contains: string[] = [];
  for (const known of KNOWN_SLASH_COMMANDS) {
    if (known.startsWith(command)) {
      exactPrefix.push(known);
      continue;
    }
    if (known.includes(command)) contains.push(known);
  }
  if (exactPrefix.length || contains.length) {
    return [...exactPrefix, ...contains].slice(0, MAX_SUGGESTIONS);
  }

  const fuzzy = KNOWN_SLASH_COMMANDS.map((known) => ({
    known,
    distance: levenshteinDistance(command, known),
  }))
    .filter((entry) => entry.distance <= MAX_LEVENSHTEIN_DISTANCE)
    .sort((a, b) => a.distance - b.distance || a.known.localeCompare(b.known))
    .map((entry) => entry.known);
  return fuzzy.slice(0, MAX_SUGGESTIONS);
}

function levenshteinDistance(left: string, right: string): number {
  if (left === right) return 0;
  if (!left) return right.length;
  if (!right) return left.length;

  const prev = Array.from({ length: right.length + 1 }, (_, index) => index);
  for (let i = 1; i <= left.length; i += 1) {
    let diagonal = prev[0];
    prev[0] = i;
    for (let j = 1; j <= right.length; j += 1) {
      const temp = prev[j];
      const cost = left[i - 1] === right[j - 1] ? 0 : 1;
      prev[j] = Math.min(prev[j] + 1, prev[j - 1] + 1, diagonal + cost);
      diagonal = temp;
    }
  }
  return prev[right.length];
}

function done(
  consumed = true,
  forwardInput?: string,
  turnMode: MessageModePrefix | null = null,
): SlashResult {
  return {
    handled: true,
    consumed,
    ...(forwardInput !== undefined ? { forwardInput } : {}),
    ...(turnMode ? { turnMode } : {}),
  };
}

async function resolveFeedbackInput(
  rest: string[],
  rawArg: string,
): Promise<{ type: FeedbackType; text: string } | null> {
  const quickType = (rest[0] ?? '').toLowerCase();
  if (quickType === 'bug' || quickType === 'feature' || quickType === 'praise') {
    const text = rawArg.slice(quickType.length).trim();
    return text ? { type: quickType, text } : null;
  }
  if (rawArg) return null;

  const type = await select<FeedbackType>({
    message: 'Feedback type',
    choices: [
      { name: 'Bug report', value: 'bug' },
      { name: 'Feature request', value: 'feature' },
      { name: 'Praise', value: 'praise' },
    ],
  }).catch(() => null);
  if (!type) return null;

  const text = await input({
    message: 'Describe your feedback',
    validate: (value) => (value.trim() ? true : 'Feedback is required'),
  }).catch(() => '');
  return text.trim() ? { type, text: text.trim() } : null;
}

function resolveToggle(value: string, current: boolean): boolean | undefined {
  const normalized = value.trim().toLowerCase();
  if (!normalized) return !current;
  if (normalized === 'on') return true;
  if (normalized === 'off') return false;
  return undefined;
}

function buildClipboardSystemSummary(session: Session): string {
  const lines = [
    'System prompt summary',
    `Mode: ${session.state.mode}`,
    `Model: ${session.state.model}`,
    `Working directory: ${session.state.cwd}`,
  ];
  if (session.state.systemPrompt?.trim()) {
    lines.push(`Custom system prompt: ${truncateMiddle(session.state.systemPrompt.trim(), 400)}`);
  } else {
    lines.push('System prompt source: built-in default');
  }
  return lines.join('\n');
}

function buildClipboardFileContext(session: Session): string {
  const lines = ['File context', `Working directory: ${session.state.cwd}`];
  const pinned = PinnedContext.fromJSON(session.state.pinned).list();
  if (pinned.length > 0) {
    lines.push('Pinned files:');
    lines.push(...pinned.map((file) => `- ${file.path} (${file.tokens} tokens)`));
  }
  const gitContext = session.state.gitContext ?? [];
  if (gitContext.length > 0) {
    lines.push('Git context:');
    lines.push(
      ...gitContext
        .slice(0, 10)
        .map((file) => `- ${file.path}${file.status ? ` [${file.status}]` : ''}`),
    );
    if (gitContext.length > 10) lines.push(`- ... ${gitContext.length - 10} more`);
  }
  return lines.length > 2 ? lines.join('\n') : '';
}

function selectLastExchange(messages: ChatCompletionMessageParam[]): ChatCompletionMessageParam[] {
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    if (messages[index]?.role === 'user') return messages.slice(index);
  }
  return messages.slice(-1);
}

function truncateMiddle(value: string, maxLength: number): string {
  if (value.length <= maxLength) return value;
  const head = Math.ceil((maxLength - 1) / 2);
  const tail = Math.floor((maxLength - 1) / 2);
  return `${value.slice(0, head)}…${value.slice(value.length - tail)}`;
}

async function runSlashShellCommand(
  command: string,
  cwd: string,
): Promise<{ exitCode: number | null; stdout: string; stderr: string }> {
  if (!shellCommandAllowed(command, loadPolicy(config.cwd))) {
    throw new Error('policy denied command execution');
  }
  assertSandbox(cwd, config.cwd);
  const safety = checkCommandSafety(command);
  if (safety.level === 'critical') {
    // eslint-disable-next-line no-control-regex
    throw new Error(formatSafetyWarning(safety).replace(/\x1B\[[0-9;]*m/g, ''));
  }
  if (safety.level === 'warn') {
    process.stdout.write(`${formatSafetyWarning(safety)}\n`);
  }

  return new Promise((resolve, reject) => {
    const isWin = process.platform === 'win32';
    const shell = isWin ? 'powershell.exe' : 'bash';
    const args = isWin ? ['-NoProfile', '-Command', command] : ['-lc', command];
    const child = spawn(shell, args, {
      cwd,
      stdio: ['ignore', 'pipe', 'pipe'],
      windowsHide: true,
    });
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (chunk) => {
      stdout += chunk.toString();
    });
    child.stderr.on('data', (chunk) => {
      stderr += chunk.toString();
    });
    child.on('error', reject);
    child.on('close', (exitCode) => {
      resolve({ exitCode, stdout, stderr });
    });
  });
}

function formatRunResult(
  command: string,
  result: { exitCode: number | null; stdout: string; stderr: string },
): string {
  const lines = [
    `${theme.brand('Run')} ${theme.dim(command)}`,
    `  exit code: ${result.exitCode ?? 'unknown'}`,
  ];
  if (result.stdout.trim()) lines.push('', result.stdout.trimEnd());
  if (result.stderr.trim()) lines.push('', theme.warn('stderr:'), result.stderr.trimEnd());
  return `${lines.join('\n')}\n`;
}

function buildRunContextMessage(
  command: string,
  result: { exitCode: number | null; stdout: string; stderr: string },
): string {
  const content = result.stdout.trim() || result.stderr.trim() || '(no output)';
  return `Command output from \`${command}\` (exit ${result.exitCode ?? 'unknown'}):\n\n\`\`\`text\n${content}\n\`\`\``;
}

function buildWebContextMessage(url: string, markdown: string, focus?: string): string {
  const lines = [`Content from ${url}:`];
  if (focus) {
    lines.push(`Focus on: ${focus}`);
  }
  lines.push('', markdown);
  return lines.join('\n');
}

function formatReadOnlyFiles(files: string[]): string {
  if (!files.length) return `${theme.dim('No read-only files.\n')}`;
  const lines = [
    `${theme.brand('Read-only files')}`,
    ...files.map((file, index) => `  ${index + 1}. ${file}`),
    '',
  ];
  return lines.join('\n');
}

function formatScheduledTasks(tasks: ScheduledTask[]): string {
  if (!tasks.length) return `${theme.dim('No scheduled prompts.\n')}`;
  const lines = [`${theme.brand('Scheduled prompts')}`];
  for (const task of tasks) {
    lines.push(
      `  ${task.id} ${theme.dim(`[${task.type}]`)} ${task.prompt}`,
      `    every: ${formatInterval(task.interval)}  next: ${task.nextRun.toISOString()}`,
    );
  }
  lines.push('');
  return lines.join('\n');
}

function formatInterval(interval: number): string {
  const parts: string[] = [];
  let remaining = interval;
  const hours = Math.floor(remaining / (60 * 60 * 1000));
  if (hours > 0) {
    parts.push(`${hours}h`);
    remaining -= hours * 60 * 60 * 1000;
  }
  const minutes = Math.floor(remaining / (60 * 1000));
  if (minutes > 0) {
    parts.push(`${minutes}m`);
    remaining -= minutes * 60 * 1000;
  }
  const seconds = Math.floor(remaining / 1000);
  if (seconds > 0 || parts.length === 0) parts.push(`${seconds}s`);
  return parts.join('');
}

function formatReasoningConfig(): string {
  const current = getReasoningConfig();
  return [
    theme.brand('Reasoning'),
    `  effort: ${current.effort ?? 'default'}`,
    `  think tokens: ${typeof current.thinkTokens === 'number' ? current.thinkTokens : 'disabled'}`,
    '',
  ].join('\n');
}

function handleRoleCommand(rest: string[], roleManager: RoleManager): string {
  const [subcommand = '', ...subArgs] = rest;
  if (!subcommand) {
    const current = roleManager.getCurrentRole();
    return `${theme.brand('Current role')} ${theme.hl(current.name)}\n  permissions: ${current.permissions.join(', ')}\n`;
  }

  if (subcommand === 'list') {
    const currentRole = roleManager.getCurrentRole().name;
    const lines = [
      theme.brand('Roles'),
      ...roleManager.listRoles().map((role) => {
        const marker = role.name === currentRole ? theme.ok('●') : theme.dim('○');
        return `  ${marker} ${role.name} ${theme.dim(role.permissions.join(', '))}`;
      }),
      '',
    ];
    return lines.join('\n');
  }

  if (subcommand === 'set') {
    const target = subArgs.join(' ').trim();
    if (!target) return `${theme.warn('usage: /role set <name>\n')}`;
    try {
      roleManager.setRole(target);
      return theme.ok(`✔ role → ${roleManager.getCurrentRole().name}\n`);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return theme.err(`${message}\n`);
    }
  }

  return theme.warn('usage: /role\n       /role list\n       /role set <name>\n');
}

function getRoleManager(cwd: string): RoleManager {
  const roleManager = new RoleManager(defaultRolesConfigPath(cwd));
  roleManager.loadRoles();
  return roleManager;
}

function correctionsCommand(args: string[]): string {
  const memory = new CorrectionMemory();
  memory.load();

  const [subcommand = 'list', ...rest] = args;
  const action = subcommand.toLowerCase();

  if (action === 'list') {
    return formatCorrections(memory.list());
  }

  if (action === 'add') {
    const raw = rest.join(' ').trim();
    const separator = raw.indexOf('->');
    if (!raw || separator === -1) return correctionsUsage();

    const wrongBehavior = raw.slice(0, separator).trim();
    const correctBehavior = raw.slice(separator + 2).trim();
    if (!wrongBehavior || !correctBehavior) return correctionsUsage();

    memory.add({
      pattern: wrongBehavior,
      wrongBehavior,
      correctBehavior,
      category: 'general',
    });
    memory.save();
    return `${theme.ok('Remembered correction')} ${theme.dim('Do NOT')} ${wrongBehavior} ${theme.dim('→')} ${correctBehavior}\n`;
  }

  if (action === 'remove') {
    const id = rest.join(' ').trim();
    if (!id) return correctionsUsage();
    const before = memory.list().length;
    memory.remove(id);
    const after = memory.list().length;
    if (before === after) return `${theme.warn(`No correction found for id ${id}.`)}\n`;
    memory.save();
    return `${theme.ok('Removed correction')} ${theme.hl(id)}\n`;
  }

  if (action === 'clear') {
    const entries = memory.list();
    for (const entry of entries) memory.remove(entry.id);
    memory.save();
    return `${theme.ok(`Cleared ${entries.length} correction${entries.length === 1 ? '' : 's'}.`)}\n`;
  }

  return correctionsUsage();
}

function formatCorrections(entries: ReturnType<CorrectionMemory['list']>): string {
  if (entries.length === 0) {
    return `${theme.brand('Corrections')}\n  ${theme.dim('No remembered corrections.')}\n`;
  }

  const lines = entries.map((entry) => {
    const details = `${entry.category}, used ${entry.frequency}x`;
    return `  ${theme.hl(entry.id)} ${theme.dim(`(${details})`)}\n    Do NOT ${entry.wrongBehavior}\n    Instead: ${entry.correctBehavior}`;
  });

  return `${theme.brand('Corrections')}\n${lines.join('\n')}\n`;
}

function correctionsUsage(): string {
  return 'Usage: /corrections\n       /corrections add <wrong> -> <correct>\n       /corrections remove <id>\n       /corrections clear\n';
}

function handleFilterSlashCommand(cwd: string, arg: string, rest: string[]): string {
  const [subcommand = 'list'] = rest;
  const action = subcommand.toLowerCase();

  try {
    if (action === 'list') {
      return formatFilterRules(loadProjectContentFilter(cwd), cwd);
    }

    if (action === 'add') {
      const [, name, patternSource, actionSource] = rest;
      if (!name || !patternSource || !actionSource) {
        return `${theme.warn('usage: /filter add <name> <pattern> <action>\n')}`;
      }
      const filterAction = parseFilterAction(actionSource);
      if (!filterAction) {
        return `${theme.warn('filter action must be redact, warn, or block\n')}`;
      }

      const savedRule = saveProjectFilterRule(cwd, {
        name,
        pattern: parseFilterPattern(patternSource),
        type: 'custom',
        action: filterAction,
      });

      return theme.ok(
        `✔ filter rule saved: ${savedRule.name} (${savedRule.type}/${savedRule.action}) /${savedRule.pattern.source}/${savedRule.pattern.flags}\n`,
      );
    }

    if (action === 'remove') {
      const [, name] = rest;
      if (!name) {
        return `${theme.warn('usage: /filter remove <name>\n')}`;
      }
      const removed = removeProjectFilterRule(cwd, name);
      if (!removed.removed) {
        return `${theme.warn(`filter rule not found: ${name}\n`)}`;
      }
      return theme.ok(`✔ removed ${removed.source} filter rule: ${name}\n`);
    }

    if (action === 'test') {
      const text = arg.slice(subcommand.length).trim();
      if (!text) {
        return `${theme.warn('usage: /filter test <text>\n')}`;
      }
      return formatFilterTestResult(loadProjectContentFilter(cwd).filter(text));
    }

    return `${theme.warn('usage: /filter | /filter add <name> <pattern> <action> | /filter remove <name> | /filter test <text>\n')}`;
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error);
    return `${theme.err(`content filter error: ${message}\n`)}`;
  }
}

async function proxyCommand(args: string[]): Promise<string> {
  const manager = ProxyManager.shared();
  const [subcommand = 'show', ...rest] = args;
  const action = subcommand.toLowerCase();

  if (action === 'show' || action === 'list' || action === 'status') {
    return formatProxyStatus(manager);
  }

  if (action === 'set') {
    const rawUrl = rest.join(' ').trim();
    if (!rawUrl) return `${theme.warn('usage: /proxy set <url>\n')}`;
    try {
      const saved = manager.setProxy(ProxyManager.parseProxyUrl(rawUrl));
      return `${theme.ok('✔ proxy configured\n')}${formatProxyDetails(
        saved,
        manager.getSource() || 'file',
        manager.getConfigPath(),
      )}`;
    } catch (error) {
      return theme.err(`proxy: ${(error as Error).message}\n`);
    }
  }

  if (action === 'clear' || action === 'unset') {
    manager.clearProxy();
    if (manager.loadConfig() && manager.getSource() === 'env') {
      return (
        `${theme.warn('proxy file cleared; environment proxy variables still apply\n')}` +
        formatProxyStatus(manager)
      );
    }
    return theme.ok(`✔ proxy cleared (${manager.getConfigPath()})\n`);
  }

  if (action === 'test') {
    const targetUrl = rest.join(' ').trim() || config.endpoint;
    if (!manager.loadConfig()) return theme.warn('no proxy configured\n');
    const result = await manager.testConnection(targetUrl);
    return result.ok
      ? `${theme.ok('✔ proxy test succeeded')} ${theme.dim(`${targetUrl} status=${result.status ?? 'n/a'} proxied=${result.proxied}`)}\n`
      : `${theme.err(`proxy test failed: ${result.error ?? 'unknown error'}`)}\n`;
  }

  return `${theme.warn('usage: /proxy [show|set <url>|clear|test [url]]\n')}`;
}

function retentionCommand(args: string[]): string {
  const manager = new RetentionManager();
  const [subcommand = 'show', targetRaw, daysRaw, countRaw, enabledRaw] = args;
  const action = subcommand.toLowerCase();

  if (action === 'show' || action === 'list' || action === 'policies') {
    return formatRetentionPolicies(manager);
  }
  if (action === 'preview') {
    return formatRetentionPreview(manager.preview(), manager);
  }
  if (action === 'enforce' || action === 'apply') {
    return formatRetentionResult(manager.enforce(), manager);
  }
  if (action === 'set') {
    const target = parseRetentionTarget(targetRaw);
    const maxAgeDays = parseRetentionCount(daysRaw);
    const parsedMaxCount = countRaw ? parseRetentionCount(countRaw) : undefined;
    const enabled = enabledRaw ? enabledRaw.toLowerCase() !== 'off' : true;
    if (!target || maxAgeDays === null || (countRaw && parsedMaxCount === null)) {
      return `${theme.warn('usage: /retention set <sessions|audit|memory|all> <days> [count] [on|off]\n')}`;
    }
    const nextPolicies = manager.setPolicy({
      target,
      maxAgeDays,
      maxCount: parsedMaxCount ?? undefined,
      enabled,
    });
    return `${theme.ok('✔ retention policy saved')}\n${nextPolicies.map((policy) => `  ${policy.target}: age=${policy.maxAgeDays}d${typeof policy.maxCount === 'number' ? ` count=${policy.maxCount}` : ''} ${policy.enabled ? 'enabled' : 'disabled'}`).join('\n')}\n`;
  }

  return `${theme.warn('usage: /retention [show|preview|enforce|set <target> <days> [count] [on|off]]\n')}`;
}

function parseRetentionTarget(value?: string): RetentionTarget | null {
  if (value === 'sessions' || value === 'audit' || value === 'memory' || value === 'all') {
    return value;
  }
  return null;
}

function parseRetentionCount(value?: string): number | null {
  if (!value) return null;
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return null;
  const normalized = Math.trunc(parsed);
  return normalized >= 0 ? normalized : null;
}

function renderCurrentProvider(model: string): string {
  return [
    `${theme.brand('Current provider')}`,
    `  name: ${config.provider}`,
    `  base URL: ${config.endpoint}`,
    `  model: ${model}`,
    '',
  ].join('\n');
}

function renderProviderList(): string {
  const providers = providerRegistry.list();
  const lines = [`${theme.brand('Providers')}`, ''];
  for (const provider of providers) {
    const marker = provider.name === config.provider ? theme.ok('●') : theme.dim('○');
    const defaultModel = provider.defaultModel || provider.models[0] || 'unknown';
    lines.push(
      `  ${marker} ${provider.name} ${theme.dim(provider.baseUrl)} ${theme.dim(`model=${defaultModel}`)}`,
    );
  }
  lines.push('');
  return lines.join('\n');
}

async function testActiveProvider(model: string): Promise<string> {
  if (isLocalProviderName(config.provider)) {
    localModelProvider.configure({
      provider: config.provider,
      baseUrl: config.endpoint,
      model,
      apiKey: config.token,
    });
    const available = await localModelProvider.isAvailable();
    const models = available ? await localModelProvider.listModels() : [];
    const header = available
      ? theme.ok('✔ local provider reachable')
      : theme.err('✖ local provider unavailable');
    const discovered = models.length ? models.join(', ') : theme.dim('(no models reported)');
    return [
      header,
      `provider: ${config.provider}`,
      `base URL: ${config.endpoint}`,
      `model: ${model}`,
      `available models: ${discovered}`,
      '',
    ].join('\n');
  }

  const result = await providerRegistry.testProvider(config.provider);
  const header = result.ok ? theme.ok('✔ provider reachable') : theme.err('✖ provider unavailable');
  return [
    header,
    `provider: ${result.provider}`,
    `base URL: ${config.endpoint}`,
    `model: ${model}`,
    `available models: ${result.models.length ? result.models.join(', ') : theme.dim('(none reported)')}`,
    ...(result.error ? [`error: ${result.error}`] : []),
    '',
  ].join('\n');
}

function formatGoalRunStatus(run: GoalRunState | null): string {
  if (!run) {
    return `${theme.brand('Goal run')}\n  ${theme.dim('No goal has been started yet.')}\n`;
  }

  const progress = run.agent.getProgress();
  const lines = [
    theme.brand('Goal run'),
    `  goal: ${run.goal.description}`,
    `  phase: ${progress.phase}`,
    `  started: ${run.startedAt}`,
    `  attempt: ${progress.currentAttempt}/${progress.maxAttempts}`,
    `  steps: ${progress.completedSteps}/${progress.totalSteps}`,
  ];

  if (progress.currentStepId) {
    lines.push(`  current step: ${progress.currentStepId}`);
  }
  if (progress.verification) {
    lines.push(
      `  verification: ${progress.verification.ok ? 'passed' : 'failed'} (${progress.verification.score})`,
    );
    if (progress.verification.issues.length > 0) {
      lines.push(`  issues: ${progress.verification.issues.join(' | ')}`);
    }
  }
  if (run.result?.summary) {
    lines.push(`  summary: ${run.result.summary}`);
  }
  if (run.error) {
    lines.push(`  error: ${run.error}`);
  }

  return `${lines.join('\n')}\n`;
}

function formatGoalCompletion(result: GoalResult): string {
  const issues =
    result.verification.issues.length > 0
      ? `\n  issues: ${result.verification.issues.join(' | ')}`
      : '';
  return (
    `${theme.brand('Goal complete')}\n` +
    `  goal: ${result.goal.description}\n` +
    `  status: ${result.success ? 'success' : result.aborted ? 'aborted' : 'failed'}\n` +
    `  attempts: ${result.attempts}\n` +
    `  summary: ${result.summary}${issues}\n`
  );
}

async function sandboxCommand(args: string[], cwd: string): Promise<string> {
  const [subcommand = 'status', ...rest] = args;
  const sandbox = getContainerSandbox(cwd);

  switch (subcommand.toLowerCase()) {
    case 'run': {
      const command = rest.join(' ').trim();
      if (!command) return theme.warn('usage: /sandbox run <command>\n');
      if (!(await sandbox.isDockerAvailable())) {
        return theme.warn(
          'Docker is not available. Start Docker Desktop or install the Docker CLI.\n',
        );
      }

      const containerId = await sandbox.create({ image: sandbox.getDefaultImage() });
      try {
        const result = await sandbox.exec(containerId, command);
        const body = [
          `${theme.brand('Sandbox run')} ${theme.dim(containerId.slice(0, 12))}`,
          result.stdout.trimEnd(),
          result.stderr.trimEnd(),
        ]
          .filter(Boolean)
          .join('\n\n');
        return `${body}\n`;
      } finally {
        await sandbox.destroy(containerId).catch(() => undefined);
      }
    }
    case 'shell': {
      if (!(await sandbox.isDockerAvailable())) {
        return theme.warn(
          'Docker is not available. Start Docker Desktop or install the Docker CLI.\n',
        );
      }

      const containerId = await sandbox.create({ image: sandbox.getDefaultImage() });
      return [
        `${theme.brand('Sandbox shell')} ${theme.dim(containerId.slice(0, 12))}`,
        `Project mounted read-only from ${cwd}`,
        `Attach with: docker exec -it ${containerId} sh`,
        `Cleanup with: /sandbox cleanup`,
        '',
      ].join('\n');
    }
    case 'status': {
      if (!(await sandbox.isDockerAvailable())) {
        return theme.warn(
          'Docker is not available. Start Docker Desktop or install the Docker CLI.\n',
        );
      }

      const containers = await sandbox.listRunning();
      if (!containers.length) return `${theme.dim('No sandbox containers are running.')}\n`;

      const lines = [`${theme.brand('Sandbox containers')}`, ''];
      for (const container of containers) {
        lines.push(
          `  ${container.id.slice(0, 12)} ${container.image} ${theme.dim(container.status)}`,
        );
      }
      lines.push('');
      return lines.join('\n');
    }
    case 'cleanup': {
      if (!(await sandbox.isDockerAvailable())) {
        return theme.warn(
          'Docker is not available. Start Docker Desktop or install the Docker CLI.\n',
        );
      }

      const containers = await sandbox.listRunning();
      if (!containers.length) return `${theme.dim('No sandbox containers to clean up.')}\n`;

      await Promise.all(
        containers.map((container) => sandbox.destroy(container.id).catch(() => undefined)),
      );
      return theme.ok(
        `✔ cleaned up ${containers.length} sandbox container${containers.length === 1 ? '' : 's'}\n`,
      );
    }
    default:
      return theme.warn(
        'usage: /sandbox run <command>\n       /sandbox shell\n       /sandbox status\n       /sandbox cleanup\n',
      );
  }
}

function getContainerSandbox(cwd: string): ContainerSandbox {
  const resolved = path.resolve(cwd);
  let sandbox = sandboxByCwd.get(resolved);
  if (!sandbox) {
    sandbox = new ContainerSandbox(resolved);
    sandboxByCwd.set(resolved, sandbox);
  }
  return sandbox;
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
    ...files.map(
      (file, index) => `  ${index + 1}. ${file.path} ${theme.dim(`(${file.tokens} tokens)`)}`,
    ),
    `  total: ${theme.hl(String(total))} tokens`,
    '',
  ];
  return lines.join('\n');
}

function formatProxyStatus(manager: ProxyManager): string {
  const proxy = manager.loadConfig();
  if (!proxy) {
    return `${theme.brand('Proxy')}\n  ${theme.dim('status')} disabled\n  ${theme.dim(
      'config',
    )} ${manager.getConfigPath()}\n`;
  }
  return formatProxyDetails(proxy, manager.getSource() || 'file', manager.getConfigPath());
}

function formatProxyDetails(
  proxy: NonNullable<ReturnType<ProxyManager['loadConfig']>>,
  source: string,
  file: string,
): string {
  const auth = proxy.auth?.username
    ? `${proxy.auth.username}${proxy.auth.password ? ':***' : ''}@`
    : '';
  const noProxy = proxy.noProxy?.length ? proxy.noProxy.join(', ') : '(none)';
  return [
    `${theme.brand('Proxy')} ${theme.dim(`[${source}]`)}`,
    `  ${theme.dim('url')} ${proxy.type}://${auth}${proxy.host}:${proxy.port}`,
    `  ${theme.dim('no_proxy')} ${noProxy}`,
    `  ${theme.dim('config')} ${file}`,
    '',
  ].join('\n');
}

function formatAuditEntries(entries: AuditEntry[], heading = 'Audit log'): string {
  if (!entries.length) {
    return `${theme.brand(heading)} ${theme.dim(auditLogPath())}\n  ${theme.dim('No audit entries found.')}\n`;
  }

  const lines = [`${theme.brand(heading)} ${theme.dim(auditLogPath())}`, ''];
  for (const entry of entries) {
    const parts = [
      entry.tool ? theme.hl(entry.tool) : entry.action,
      theme.dim(entry.result.toUpperCase()),
      theme.dim(entry.timestamp),
    ];
    if (typeof entry.duration === 'number') parts.push(theme.dim(`${entry.duration}ms`));
    lines.push(`  ${parts.join('  ')}`);
    if (entry.command) lines.push(`    command: ${entry.command}`);
    if (entry.details) lines.push(`    details: ${entry.details.replace(/\r?\n/gu, ' ')}`);
  }
  lines.push('');
  return lines.join('\n');
}

function formatAuditStats(stats: AuditStats): string {
  return [
    `${theme.brand('Audit stats')} ${theme.dim(auditLogPath())}`,
    `  total:    ${theme.hl(String(stats.total))}`,
    `  success:  ${theme.ok(String(stats.success))}`,
    `  failure:  ${theme.err(String(stats.failure))}`,
    `  denied:   ${theme.warn(String(stats.denied))}`,
    `  first:    ${theme.dim(stats.firstEntry || 'n/a')}`,
    `  last:     ${theme.dim(stats.lastEntry || 'n/a')}`,
    `  avg time: ${theme.dim(stats.avgDuration !== undefined ? `${stats.avgDuration}ms` : 'n/a')}`,
    '',
    theme.brand('Top tools'),
    formatAuditCounter(stats.byTool),
    '',
  ].join('\n');
}

function formatAuditCounter(counter: Record<string, number>): string {
  const entries = Object.entries(counter)
    .sort((left, right) => right[1] - left[1] || left[0].localeCompare(right[0]))
    .slice(0, 5);
  if (entries.length === 0) return `  ${theme.dim('none')}`;
  return entries
    .map(([name, count]) => `  ${theme.hl(String(count)).padStart(5)}  ${name}`)
    .join('\n');
}

function searchAuditEntries(entries: AuditEntry[], query: string): AuditEntry[] {
  const needle = query.trim().toLowerCase();
  if (!needle) return [];
  return entries.filter((entry) =>
    [
      entry.id,
      entry.timestamp,
      entry.action,
      entry.tool,
      entry.command,
      entry.result,
      entry.user,
      entry.details,
      safeAuditArgs(entry.args),
    ]
      .filter((part): part is string => typeof part === 'string' && part.length > 0)
      .some((part) => part.toLowerCase().includes(needle)),
  );
}

function safeAuditArgs(value: unknown): string {
  try {
    return value === undefined ? '' : JSON.stringify(value);
  } catch {
    return '';
  }
}

function formatCloudUsage(currentSessionId?: string): string {
  const lines = [
    'usage: /cloud create [name]',
    '       /cloud connect <id>',
    '       /cloud list',
    '       /cloud destroy <id>',
    '       /cloud sync',
  ];
  if (currentSessionId) lines.push(`current cloud session: ${currentSessionId}`);
  return `${lines.join('\n')}\n`;
}

function formatCloudSessions(sessions: CloudSessionRecord[]): string {
  if (!sessions.length) return `${theme.dim('No cloud sessions.\n')}`;
  const lines = [`${theme.brand('Cloud sessions')}`, ''];
  for (const session of sessions) {
    const status = session.status === 'connected' ? theme.ok('connected') : theme.dim('idle');
    const label =
      session.name && session.name !== session.id ? ` ${theme.dim(`(${session.name})`)}` : '';
    const synced = session.lastSyncedAt ? ` synced ${session.lastSyncedAt}` : '';
    lines.push(`  ${session.id} ${status}${label} ${theme.dim(`msgs=${session.messageCount}`)}`);
    lines.push(`    ${session.endpoint}${synced}`);
  }
  lines.push('');
  return lines.join('\n');
}

function formatNavigationResult(label: string, symbol: string, locations: Location[]): string {
  const lines = [`${theme.brand(label)} ${theme.hl(symbol)}`, ''];
  for (const location of locations) {
    const position = `${location.file}:${location.line}${location.column ? `:${location.column}` : ''}`;
    lines.push(`  ${position}`);
    lines.push(`    ${location.context}`);
  }
  lines.push('');
  return lines.join('\n');
}

function parseParallelSpec(
  raw: string,
): { agents: AgentTask[]; concurrencyLimit?: number; timeoutMs?: number } | { error: string } {
  const trimmed = raw.trim();
  if (!trimmed) {
    return {
      error:
        'usage: /parallel <json-spec|prompt-a, prompt-b>\n' +
        'example: /parallel [{"name":"plan","type":"plan","prompt":"outline the release"}]',
    };
  }

  if (trimmed.startsWith('[') || trimmed.startsWith('{')) {
    try {
      const parsed = JSON.parse(trimmed) as unknown;
      if (Array.isArray(parsed)) {
        return { agents: normalizeAgentTasks(parsed) };
      }
      if (parsed && typeof parsed === 'object') {
        const spec = parsed as {
          agents?: unknown;
          concurrencyLimit?: unknown;
          timeoutMs?: unknown;
        };
        if (Array.isArray(spec.agents)) {
          return {
            agents: normalizeAgentTasks(spec.agents),
            concurrencyLimit:
              typeof spec.concurrencyLimit === 'number'
                ? Math.floor(spec.concurrencyLimit)
                : undefined,
            timeoutMs: typeof spec.timeoutMs === 'number' ? Math.floor(spec.timeoutMs) : undefined,
          };
        }
      }
      return {
        error: 'invalid /parallel JSON: expected an array or an object with an "agents" array',
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : 'failed to parse JSON';
      return { error: `invalid /parallel JSON: ${message}` };
    }
  }

  const prompts = trimmed
    .split(',')
    .map((part) => part.trim())
    .filter((part) => part.length > 0);
  if (!prompts.length) {
    return { error: 'usage: /parallel <json-spec|prompt-a, prompt-b>' };
  }
  return {
    agents: prompts.map((prompt, index) => ({
      name: `agent-${index + 1}`,
      type: 'task',
      prompt,
    })),
  };
}

function normalizeAgentTasks(input: unknown[]): AgentTask[] {
  return input.map((entry, index) => {
    const task = (entry ?? {}) as Partial<AgentTask>;
    const prompt = typeof task.prompt === 'string' ? task.prompt.trim() : '';
    return {
      name:
        typeof task.name === 'string' && task.name.trim() ? task.name.trim() : `agent-${index + 1}`,
      type: typeof task.type === 'string' && task.type.trim() ? task.type.trim() : 'task',
      prompt,
      ...(typeof task.systemPrompt === 'string' && task.systemPrompt.trim()
        ? { systemPrompt: task.systemPrompt.trim() }
        : {}),
    };
  });
}

function formatParallelResults(run: ParallelAgentRunResult): string {
  if (!run.results.length) return `${theme.warn('No agent tasks were provided.')}\n`;

  const lines = [`${theme.brand('Parallel agent results')}`, '', run.aggregated.summary];
  if (run.aggregated.conflicts.length) {
    lines.push('', '## Conflicts', ...run.aggregated.conflicts);
  }
  lines.push('');
  for (const result of run.results) {
    const status = result.status === 'success' ? theme.ok('SUCCESS') : theme.err('ERROR');
    lines.push(`${status} ${result.name} ${theme.dim(`(${formatDuration(result.duration)})`)}`);
    lines.push(result.output.trim() || theme.dim('(empty output)'));
    lines.push('');
  }
  return `${lines.join('\n').trimEnd()}\n`;
}

function formatDeadCodeReport(rootDir: string, report: DeadCodeReport): string {
  const lines = [
    `${theme.brand('Dead code report')} ${theme.dim(rootDir)}`,
    `  scanned: ${theme.hl(String(report.stats.total))} items`,
    `  unused: ${theme.hl(String(report.stats.unused))} ${theme.dim(`(${report.stats.percentage.toFixed(2)}%)`)}`,
    '',
  ];

  if (report.unusedExports.length) {
    lines.push('Unused exports');
    for (const entry of report.unusedExports) {
      lines.push(`  - ${entry.file}:${entry.line} ${entry.name} ${theme.dim(`(${entry.kind})`)}`);
    }
    lines.push('');
  }

  if (report.unusedFiles.length) {
    lines.push('Unused files');
    for (const file of report.unusedFiles) {
      lines.push(`  - ${file}`);
    }
    lines.push('');
  }

  if (!report.unusedExports.length && !report.unusedFiles.length) {
    lines.push(theme.ok('✔ no unused exports or files detected'), '');
  }

  return `${lines.join('\n').trimEnd()}\n`;
}

function formatDuration(durationMs: number): string {
  if (durationMs < 1000) return `${durationMs}ms`;
  return `${(durationMs / 1000).toFixed(2)}s`;
}

function parseHealArgs(args: string[]): { maxAttempts: number } | { error: string } {
  let maxAttempts = 3;

  for (let index = 0; index < args.length; index += 1) {
    const token = args[index];
    if (token === '--max') {
      const value = args[index + 1];
      const parsed = Number.parseInt(value ?? '', 10);
      if (!Number.isFinite(parsed) || parsed < 1) {
        return { error: 'usage: /heal [--max <positive-number>]' };
      }
      maxAttempts = parsed;
      index += 1;
      continue;
    }

    return { error: `unknown /heal option: ${token}` };
  }

  return { maxAttempts };
}

function formatHealResult(result: import('../agents/self-heal.js').HealResult): string {
  const lines = [
    `${theme.brand('Self-heal build')} ${theme.dim(result.command)}`,
    `  status: ${result.success ? theme.ok('success') : theme.err('failed')}`,
  ];

  if (result.attempts.length === 0) {
    lines.push(`  attempts: ${theme.dim('no safe fixes applied')}`);
  } else {
    lines.push(`  attempts: ${theme.hl(String(result.attempts.length))}`);
    for (const [index, attempt] of result.attempts.entries()) {
      const location = attempt.error.file
        ? `${attempt.error.file}${attempt.error.line ? `:${attempt.error.line}` : ''}`
        : 'unknown location';
      lines.push(`  ${index + 1}. ${theme.hl(location)}`);
      lines.push(`     diagnosis: ${attempt.diagnosis}`);
      lines.push(`     fix: ${attempt.fix}`);
      lines.push(`     applied: ${attempt.applied ? theme.ok('yes') : theme.err('no')}`);
    }
  }

  if (!result.success && result.build.errors.length > 0) {
    lines.push('  remaining errors:');
    for (const error of result.build.errors.slice(0, 5)) {
      lines.push(
        `    - ${error.code ? `${error.code} ` : ''}${error.message}${error.file ? ` ${theme.dim(`(${error.file}${error.line ? `:${error.line}` : ''})`)}` : ''}`,
      );
    }
  }

  lines.push('');
  return lines.join('\n');
}

function buildTddSpec(description: string): TDDSpec {
  const clauses = description
    .split(/\s+(?:and|then)\s+|,/i)
    .map((part) => part.trim())
    .filter(Boolean);
  const expectedBehaviors = [
    'captures the original description',
    ...clauses.map((clause) => `handles ${clause.toLowerCase()}`),
  ];
  return {
    description,
    expectedBehaviors: [...new Set(expectedBehaviors)],
  };
}

function formatTddCycle(result: TDDResult): string {
  const status = result.finalStatus === 'green' ? theme.ok('green') : theme.err('red');
  return [
    `${theme.brand('TDD cycle')} ${status}`,
    `  spec: ${theme.hl(result.spec.description)}`,
    `  test: ${result.testFile}`,
    `  source: ${result.sourceFile}`,
    `  cycles: ${result.cycles}`,
    '',
  ].join('\n');
}

function formatTddStatus(result: TDDResult | null): string {
  if (!result) {
    return `${theme.brand('TDD status')}\n  ${theme.dim('No TDD cycle has been run yet.')}\n`;
  }
  return [
    `${theme.brand('TDD status')}`,
    `  status: ${result.finalStatus === 'green' ? theme.ok('green') : theme.err('red')}`,
    `  spec: ${theme.hl(result.spec.description)}`,
    `  test: ${result.testFile}`,
    `  source: ${result.sourceFile}`,
    `  cycles: ${result.cycles}`,
    '',
  ].join('\n');
}

async function bridgeCommand(args: string[]): Promise<string> {
  const [subcommand = 'status', rawPort] = args;

  switch (subcommand.toLowerCase()) {
    case 'start': {
      const parsedPort = parseBridgePort(rawPort);
      if (typeof parsedPort === 'string') return `${theme.warn(parsedPort)}\n`;
      const port = await ideBridgeServer.start(parsedPort ?? DEFAULT_BRIDGE_PORT);
      return [
        theme.ok('✔ IDE bridge started'),
        `  port:        ${theme.hl(String(port))}`,
        `  connections: ${theme.hl(String(ideBridgeServer.getConnectionCount()))}`,
        '',
      ].join('\n');
    }
    case 'stop':
      if (!ideBridgeServer.isRunning()) {
        return `${theme.warn('IDE bridge is not running.')}\n`;
      }
      await ideBridgeServer.stop();
      return `${theme.ok('✔ IDE bridge stopped')}\n`;
    case 'status':
      return formatBridgeStatus();
    default:
      return [
        theme.warn(`unknown bridge subcommand: ${subcommand}`),
        'usage: /bridge start [port]',
        '       /bridge stop',
        '       /bridge status',
        '',
      ].join('\n');
  }
}

async function serveCommand(args: string[]): Promise<string> {
  const [subcommand = 'status', rawPort] = args;

  switch (subcommand.toLowerCase()) {
    case 'start': {
      const parsedPort = parseServePort(rawPort);
      if (typeof parsedPort === 'string') return `${theme.warn(parsedPort)}\n`;
      const port = await apiServer.start(parsedPort ?? DEFAULT_API_PORT);
      return [
        theme.ok('✔ API server started'),
        `  port:     ${theme.hl(String(port))}`,
        `  sessions: ${theme.hl(String(apiServer.getSessionCount()))}`,
        '',
      ].join('\n');
    }
    case 'stop':
      if (!apiServer.isRunning()) {
        return `${theme.warn('API server is not running.')}\n`;
      }
      await apiServer.stop();
      return `${theme.ok('✔ API server stopped')}\n`;
    case 'status':
      if (!apiServer.isRunning()) {
        return `${theme.warn('API server is stopped.')}\n`;
      }
      return [
        theme.brand('API server status'),
        `  running:  ${theme.hl('yes')}`,
        `  port:     ${theme.hl(String(apiServer.getPort() ?? DEFAULT_API_PORT))}`,
        `  sessions: ${theme.hl(String(apiServer.getSessionCount()))}`,
        '',
      ].join('\n');
    case 'open': {
      const parsedPort = parseServePort(rawPort);
      if (typeof parsedPort === 'string') return `${theme.warn(parsedPort)}\n`;
      const port = await apiServer.start(parsedPort ?? DEFAULT_API_PORT);
      const url = `http://127.0.0.1:${port}/`;
      try {
        await openBrowser(url);
      } catch (error: unknown) {
        const message = error instanceof Error ? error.message : String(error);
        return `${theme.warn(`failed to open browser automatically: ${message}`)}\n${theme.dim(`Open ${url} manually.\n`)}`;
      }
      return `${theme.ok(`✔ opened browser UI at ${url}`)}\n`;
    }
    default:
      return [
        theme.warn(`unknown serve subcommand: ${subcommand}`),
        'usage: /serve start [port]',
        '       /serve stop',
        '       /serve status',
        '       /serve open [port]',
        '',
      ].join('\n');
  }
}

function formatBridgeStatus(): string {
  if (!ideBridgeServer.isRunning()) {
    return `${theme.warn('IDE bridge is stopped.')}\n`;
  }

  return [
    theme.brand('IDE bridge status'),
    `  running:     ${theme.hl('yes')}`,
    `  port:        ${theme.hl(String(ideBridgeServer.getPort() ?? DEFAULT_BRIDGE_PORT))}`,
    `  connections: ${theme.hl(String(ideBridgeServer.getConnectionCount()))}`,
    '',
  ].join('\n');
}

function parseBridgePort(value?: string): number | undefined | string {
  if (!value) return undefined;
  const port = Number.parseInt(value, 10);
  if (!Number.isInteger(port) || port < 1 || port > 65_535) {
    return `invalid port: ${value}`;
  }
  return port;
}

function parseServePort(value?: string): number | undefined | string {
  if (!value) return undefined;
  const port = Number.parseInt(value, 10);
  if (!Number.isInteger(port) || port < 1 || port > 65_535) {
    return `invalid port: ${value}`;
  }
  return port;
}

async function workflowCommand(args: string[], cwd: string): Promise<string> {
  const [subcommand = 'list', rawName] = args;
  const engine = new WorkflowEngine({ cwd });
  const workflowDir = path.join(cwd, '.icopilot', 'workflows');

  switch (subcommand.toLowerCase()) {
    case 'list': {
      const builtins = [...BUILTIN_WORKFLOWS].sort((a, b) => a.name.localeCompare(b.name));
      let local: WorkflowDef[] = [];
      let loadError: string | undefined;

      try {
        local = engine.loadWorkflows(cwd);
      } catch (error: any) {
        loadError = error?.message || String(error);
      }

      const lines = [`${theme.brand('Workflows')} ${theme.dim(workflowDir)}`, ''];
      lines.push(
        formatWorkflowSection('Built-in', builtins),
        '',
        formatWorkflowSection('Project', local),
      );
      if (loadError) {
        lines.push('', theme.warn(`warning: ${loadError}`));
      }
      return `${lines.join('\n')}\n`;
    }
    case 'run': {
      if (!rawName) return theme.warn('usage: /workflow run <name>\n');
      const workflow = findWorkflowByName(rawName, engine, cwd);
      if (!workflow) return theme.warn(`workflow not found: ${rawName}\n`);

      const validation = engine.validateWorkflow(workflow);
      if (validation.length > 0) {
        return `${formatValidationErrors(workflow.name, validation)}\n`;
      }

      const result = await engine.run(workflow, { cwd });
      return `${formatWorkflowRun(workflow.name, result)}\n`;
    }
    case 'new': {
      if (!rawName) return theme.warn('usage: /workflow new <name>\n');
      const name = normalizeWorkflowName(rawName);
      const targetPath = path.join(workflowDir, `${name}.yaml`);
      if (fs.existsSync(targetPath)) {
        return theme.warn(`workflow already exists: ${targetPath}\n`);
      }

      fs.mkdirSync(workflowDir, { recursive: true });
      const workflow = getBuiltinWorkflow(name) ?? createWorkflowTemplate(name);
      fs.writeFileSync(targetPath, renderWorkflowYaml(workflow), 'utf8');
      return theme.ok(`✔ created ${targetPath}\n`);
    }
    case 'validate': {
      if (!rawName) return theme.warn('usage: /workflow validate <name>\n');
      const workflow = findWorkflowByName(rawName, engine, cwd);
      if (!workflow) return theme.warn(`workflow not found: ${rawName}\n`);

      const errors = engine.validateWorkflow(workflow);
      if (errors.length === 0) {
        return theme.ok(`✔ workflow "${workflow.name}" is valid\n`);
      }
      return `${formatValidationErrors(workflow.name, errors)}\n`;
    }
    default:
      return theme.warn('usage: /workflow <list|run|new|validate> [name]\n');
  }
}

function findWorkflowByName(
  name: string,
  engine: WorkflowEngine,
  cwd: string,
): WorkflowDef | undefined {
  const normalized = normalizeWorkflowName(name);
  try {
    const local = engine.loadWorkflows(cwd);
    const localMatch = local.find(
      (workflow) => normalizeWorkflowName(workflow.name) === normalized,
    );
    if (localMatch) return localMatch;
  } catch {
    /* ignore local workflow parse failures here */
  }
  return getBuiltinWorkflow(normalized);
}

function normalizeWorkflowName(name: string): string {
  return name
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

function formatWorkflowSection(title: string, workflows: WorkflowDef[]): string {
  if (workflows.length === 0) {
    return `  ${theme.brand(title)}\n    ${theme.dim('none')}`;
  }

  return [
    `  ${theme.brand(title)}`,
    ...workflows.map(
      (workflow) => `    ${theme.hl(workflow.name)} ${theme.dim(`- ${workflow.description}`)}`,
    ),
  ].join('\n');
}

function formatValidationErrors(name: string, errors: ValidationError[]): string {
  return [
    `${theme.brand('Workflow validation')} ${theme.dim(name)}`,
    ...errors.map((error) => `  - ${error.path}: ${error.message}`),
  ].join('\n');
}

function formatWorkflowRun(
  name: string,
  result: {
    success: boolean;
    duration: number;
    steps: Array<{ stepId: string; success: boolean; error?: string }>;
  },
): string {
  const lines = [
    `${theme.brand('Workflow run')} ${theme.dim(name)}`,
    `  status: ${result.success ? theme.ok('success') : theme.err('failed')}`,
    `  duration: ${theme.dim(`${result.duration}ms`)}`,
  ];

  for (const step of result.steps) {
    lines.push(
      `  - ${step.stepId}: ${step.success ? theme.ok('ok') : theme.err('failed')}${step.error ? ` ${theme.dim(step.error)}` : ''}`,
    );
  }

  return lines.join('\n');
}

function errorWatchCommand(args: string[]): string {
  const [subcommand, ...rest] = args;
  const action = subcommand?.toLowerCase();

  if (!action) {
    return `${theme.brand('Error watch')}\n  /error-watch start <cmd>\n  /error-watch stop\n  /error-watch status\n`;
  }

  switch (action) {
    case 'start': {
      const command = rest.join(' ').trim();
      if (!command) {
        return theme.warn('usage: /error-watch start <cmd>\n');
      }

      try {
        errorWatcher.start(command);
        return `${theme.ok('✔ error watcher started')}\n${formatErrorWatchStatus()}`;
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        return theme.err(`failed to start error watcher: ${message}\n`);
      }
    }
    case 'stop':
      errorWatcher.stop();
      return `${theme.ok('✔ error watcher stopped')}\n${formatErrorWatchStatus()}`;
    case 'status':
      return formatErrorWatchStatus();
    default:
      return `${theme.warn(`unknown error-watch subcommand: ${subcommand}`)}\n${theme.dim(
        'usage: /error-watch start <cmd> | /error-watch stop | /error-watch status\n',
      )}`;
  }
}

function formatErrorWatchStatus(): string {
  const errors = errorWatcher.getErrors();
  const lines = [
    theme.brand('Error watch status'),
    `  active:  ${theme.hl(errorWatcher.isRunning() ? 'yes' : 'no')}`,
    `  command: ${theme.hl(errorWatcher.getCommand() ?? 'n/a')}`,
    `  errors:  ${theme.hl(String(errors.length))}`,
  ];

  if (!errors.length) {
    lines.push('', theme.dim('No parsed errors yet.'));
    return `${lines.join('\n')}\n`;
  }

  lines.push('', theme.brand('Latest errors'));
  for (const error of errors.slice(-5)) {
    lines.push(`  - ${formatParsedError(error)}`);
  }

  return `${lines.join('\n')}\n`;
}

function formatParsedError(error: ParsedError): string {
  const location = [
    error.file,
    error.line !== undefined ? String(error.line) : undefined,
    error.column !== undefined ? String(error.column) : undefined,
  ]
    .filter((part): part is string => Boolean(part))
    .join(':');

  const prefix = [error.severity, error.code, location]
    .filter((part): part is string => Boolean(part))
    .join(' ');
  return `${prefix}: ${error.message}`;
}

function formatStackTraceSummary(
  trace: ReturnType<typeof parseStackTrace>,
  analysis: ReturnType<typeof analyzeStackTrace>,
): string {
  const relevant = analysis.relevantFrames.length
    ? analysis.relevantFrames
        .map((frame, index) => {
          const location = `${frame.file}:${frame.line}${frame.column ? `:${frame.column}` : ''}`;
          const fn = frame.function ? ` ${theme.dim(`(${frame.function})`)}` : '';
          return `  ${index + 1}. ${location}${fn}`;
        })
        .join('\n')
    : '  none\n';
  const files = analysis.userFiles.length
    ? analysis.userFiles.map((file) => `  - ${file}`).join('\n')
    : '  - none detected';
  const rootCauseLocation =
    analysis.rootCause.line > 0
      ? `${analysis.rootCause.file}:${analysis.rootCause.line}${analysis.rootCause.column ? `:${analysis.rootCause.column}` : ''}`
      : analysis.rootCause.file;

  return [
    `${theme.brand('Stack trace analysis')} ${theme.dim(trace.type)}`,
    `  error: ${trace.error}`,
    `  root cause: ${rootCauseLocation}${analysis.rootCause.function ? ` ${theme.dim(`(${analysis.rootCause.function})`)}` : ''}`,
    '  relevant frames:',
    relevant,
    '  user files:',
    files,
    `  suggestion: ${analysis.suggestion}`,
    '',
  ].join('\n');
}
