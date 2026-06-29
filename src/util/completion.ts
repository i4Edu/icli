import { loadCustomAgents } from '../agents/custom-agents.js';

export interface CompletionContext {
  slashCommands: string[];
  flags: string[];
  agentNames: string[];
  slashSubcommands: Record<string, string[]>;
}

const defaultSlashCommands = [
  'help',
  'clear',
  'new',
  'goal',
  'model',
  'provider',
  'cwd',
  'diff',
  'changes',
  'diff-review',
  'git-log',
  'context',
  'usage',
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
  'settings',
  'feedback',
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
  'commit',
  'pr',
  'review',
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
  'profile',
  'role',
  'style',
  'conventions',
  'stats',
  'metrics',
  'audit',
  'explain',
  'explain-shell',
  'suggest',
  'generate',
  'actions',
  'codegen',
  'summary',
  'agent',
  'explore',
  'compare',
  'env',
  'trigger',
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
  'doctor',
  'tdd',
  'task',
  'tasks',
  'todo',
  'deps',
  'init',
  'security',
  'proxy',
  'filter',
  'retention',
  'dead-code',
  'refactor',
  'stacktrace',
  'history',
  'bookmark',
  'alias',
  'skill',
  'stash',
  'multi',
  'parallel',
  'watch',
  'web',
  'run',
  'bridge',
  'error-watch',
  'memory',
  'corrections',
  'repo',
  'hook',
  'team-memory',
  'space',
  'doc',
  'diagram',
  'extension',
  'serve',
  'worktree',
  'plugin',
  'workflow',
  'sandbox',
  'ask',
  'code',
  'architect',
  'exit',
  'quit',
];

const defaultFlags = [
  '-p',
  '--prompt',
  '--model',
  '--provider',
  '--base-url',
  '--local',
  '--provider',
  '--cwd',
  '--sandbox',
  '--tui',
  '--architect',
  '--verbose',
  '--serve',
  '--browser',
  '--help',
  '--version',
];

const defaultAgentNames = ['explore', 'task', 'review', 'plan'];
const undoArgs = ['--hard', 'file', 'status'];
const defaultSlashSubcommands: Record<string, string[]> = {
  memory: ['list', 'add', 'remove', 'clear', 'search', 'auto'],
  'memory auto': ['list', 'clear', 'forget'],
};

export function defaultContext(projectRoot = process.cwd()): CompletionContext {
  const customAgentNames = safeCustomAgentNames(projectRoot);
  return {
    slashCommands: [...defaultSlashCommands],
    flags: [...defaultFlags],
    agentNames: [...new Set([...defaultAgentNames, ...customAgentNames])],
    slashSubcommands: structuredClone(defaultSlashSubcommands),
  };
}

export function bashCompletion(ctx: CompletionContext = defaultContext()): string {
  const commands = ctx.slashCommands
    .map((command) => `/${command}`)
    .map(bashWord)
    .join(' ');
  const flags = ctx.flags.map(bashWord).join(' ');
  const agentNames = ctx.agentNames.map(bashWord).join(' ');
  const undoOptions = undoArgs.map(bashWord).join(' ');
  const memorySubcommands = (ctx.slashSubcommands.memory ?? []).map(bashWord).join(' ');
  const memoryAutoSubcommands = (ctx.slashSubcommands['memory auto'] ?? []).map(bashWord).join(' ');
  const bashCompWordCur = '${COMP_WORDS[COMP_CWORD]}';
  const bashCompWordPrev = '${COMP_WORDS[COMP_CWORD-1]}';
  const bashCompWordPrevPrev = '${COMP_WORDS[COMP_CWORD-2]}';

  return `# bash completion for icopilot and icli
_icopilot() {
  local cur prev
  COMPREPLY=()

  if type _init_completion >/dev/null 2>&1; then
    _init_completion -n : || return
  else
    cur="${bashCompWordCur}"
    prev="${bashCompWordPrev}"
  fi

  local slash_commands='${commands}'
  local flags='${flags}'
  local agent_names='${agentNames}'
  local undo_args='${undoOptions}'
  local memory_subcommands='${memorySubcommands}'
  local memory_auto_subcommands='${memoryAutoSubcommands}'

  if [[ "$prev" == "/agent" ]]; then
    COMPREPLY=( $(compgen -W "$agent_names" -- "$cur") )
    return
  fi

  if [[ "$prev" == "/undo" ]]; then
    COMPREPLY=( $(compgen -W "$undo_args" -- "$cur") )
    return
  fi

  if [[ "$prev" == "/memory" ]]; then
    COMPREPLY=( $(compgen -W "$memory_subcommands" -- "$cur") )
    return
  fi

  if [[ "$prev" == "auto" && "${bashCompWordPrevPrev}" == "/memory" ]]; then
    COMPREPLY=( $(compgen -W "$memory_auto_subcommands" -- "$cur") )
    return
  fi

  case "$cur" in
    /*)
      COMPREPLY=( $(compgen -W "$slash_commands" -- "$cur") )
      return
      ;;
    -* )
      COMPREPLY=( $(compgen -W "$flags" -- "$cur") )
      return
      ;;
  esac

  if declare -F _filedir >/dev/null 2>&1; then
    _filedir
  fi
}

complete -F _icopilot icopilot icli
`;
}

export function zshCompletion(ctx: CompletionContext = defaultContext()): string {
  const commands = ctx.slashCommands
    .map((command) => `/${command}`)
    .map(zshSingleQuoted)
    .join(' ');
  const flagSpecs = ctx.flags
    .map((flag) => `    ${zshSingleQuoted(`${flag}[icopilot option]`)} \\\n`)
    .join('');
  const agentNames = ctx.agentNames.map(zshSingleQuoted).join(' ');
  const undoOptions = undoArgs.map(zshSingleQuoted).join(' ');
  const memorySubcommands = (ctx.slashSubcommands.memory ?? []).map(zshSingleQuoted).join(' ');
  const memoryAutoSubcommands = (ctx.slashSubcommands['memory auto'] ?? [])
    .map(zshSingleQuoted)
    .join(' ');

  return `#compdef icopilot icli

_icopilot() {
  local -a slash_commands
  slash_commands=(${commands})
  local -a agent_names
  agent_names=(${agentNames})
  local -a undo_args
  undo_args=(${undoOptions})
  local -a memory_subcommands
  memory_subcommands=(${memorySubcommands})
  local -a memory_auto_subcommands
  memory_auto_subcommands=(${memoryAutoSubcommands})

  _arguments \\
${flagSpecs}    '*::arg:->args'

  case $state in
    args)
      if (( CURRENT >= 2 )) && [[ \${words[CURRENT-1]} == /agent ]]; then
        compadd -- $agent_names
      elif (( CURRENT >= 2 )) && [[ \${words[CURRENT-1]} == /undo ]]; then
        compadd -- $undo_args
      elif (( CURRENT >= 2 )) && [[ \${words[CURRENT-1]} == /memory ]]; then
        compadd -- $memory_subcommands
      elif (( CURRENT >= 3 )) && [[ \${words[CURRENT-2]} == /memory && \${words[CURRENT-1]} == auto ]]; then
        compadd -- $memory_auto_subcommands
      elif [[ $PREFIX == /* ]]; then
        compadd -- $slash_commands
      else
        _files
      fi
      ;;
  esac
}

_icopilot "$@"
`;
}

export function pwshCompletion(ctx: CompletionContext = defaultContext()): string {
  const commands = ctx.slashCommands
    .map((command) => `/${command}`)
    .map(pwshSingleQuoted)
    .join(', ');
  const flags = ctx.flags.map(pwshSingleQuoted).join(', ');
  const agentNames = ctx.agentNames.map(pwshSingleQuoted).join(', ');
  const undoOptions = undoArgs.map(pwshSingleQuoted).join(', ');
  const memorySubcommands = (ctx.slashSubcommands.memory ?? []).map(pwshSingleQuoted).join(', ');
  const memoryAutoSubcommands = (ctx.slashSubcommands['memory auto'] ?? [])
    .map(pwshSingleQuoted)
    .join(', ');

  return `# PowerShell completion for icopilot and icli
Register-ArgumentCompleter -Native -CommandName icopilot,icli -ScriptBlock {
  param($wordToComplete, $commandAst, $cursorPosition)

  $slashCommands = @(${commands})
  $flags = @(${flags})
  $agentNames = @(${agentNames})
  $undoArgs = @(${undoOptions})
  $memorySubcommands = @(${memorySubcommands})
  $memoryAutoSubcommands = @(${memoryAutoSubcommands})
  $elements = @($commandAst.CommandElements | ForEach-Object { $_.Extent.Text })

  if ($elements.Count -ge 2 -and $elements[$elements.Count - 2] -eq '/agent') {
    $candidates = $agentNames
  } elseif ($elements.Count -ge 2 -and $elements[$elements.Count - 2] -eq '/undo') {
    $candidates = $undoArgs
  } elseif ($elements.Count -ge 2 -and $elements[$elements.Count - 2] -eq '/memory') {
    $candidates = $memorySubcommands
  } elseif ($elements.Count -ge 3 -and $elements[$elements.Count - 3] -eq '/memory' -and $elements[$elements.Count - 2] -eq 'auto') {
    $candidates = $memoryAutoSubcommands
  } elseif ($wordToComplete -like '/*') {
    $candidates = $slashCommands
  } elseif ($wordToComplete -like '-*') {
    $candidates = $flags
  } else {
    $candidates = $slashCommands + $flags
  }

  $candidates |
    Where-Object { $_ -like "$wordToComplete*" } |
    ForEach-Object { [System.Management.Automation.CompletionResult]::new($_, $_, 'ParameterValue', $_) }
}
`;
}

function bashWord(value: string): string {
  return value.replace(/[\\'"$`\s]/g, '\\$&');
}

function zshSingleQuoted(value: string): string {
  return `'${value.replace(/'/g, `'\\''`)}'`;
}

function pwshSingleQuoted(value: string): string {
  return `'${value.replace(/'/g, `''`)}'`;
}

function safeCustomAgentNames(projectRoot: string): string[] {
  try {
    return loadCustomAgents(projectRoot).map((agent) => agent.name);
  } catch {
    return [];
  }
}
