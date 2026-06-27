import { loadCustomAgents } from '../agents/custom-agents.js';

export interface CompletionContext {
  slashCommands: string[];
  flags: string[];
  agentNames: string[];
}

const defaultSlashCommands = [
  'help',
  'clear',
  'new',
  'goal',
  'model',
  'provider',
  'provider',
  'cwd',
  'diff',
  'diff-review',
  'git-log',
  'context',
  'pin',
  'unpin',
  'tokens',
  'compact',
  'sessions',
  'cloud',
  'export',
  'share',
  'handoff',
  'plan',
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
  'audit',
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
  'heal',
  'lint',
  'test',
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
  'plugin',
  'workflow',
  'sandbox',
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
  '--verbose',
  '--serve',
  '--help',
  '--version',
];

const defaultAgentNames = ['explore', 'task', 'review', 'plan'];

export function defaultContext(projectRoot = process.cwd()): CompletionContext {
  const customAgentNames = safeCustomAgentNames(projectRoot);
  return {
    slashCommands: [...defaultSlashCommands],
    flags: [...defaultFlags],
    agentNames: [...new Set([...defaultAgentNames, ...customAgentNames])],
  };
}

export function bashCompletion(ctx: CompletionContext = defaultContext()): string {
  const commands = ctx.slashCommands
    .map((command) => `/${command}`)
    .map(bashWord)
    .join(' ');
  const flags = ctx.flags.map(bashWord).join(' ');
  const agentNames = ctx.agentNames.map(bashWord).join(' ');

  return `# bash completion for icopilot and icli
_icopilot() {
  local cur prev
  COMPREPLY=()

  if type _init_completion >/dev/null 2>&1; then
    _init_completion -n : || return
  else
    cur="\${COMP_WORDS[COMP_CWORD]}"
    prev="\${COMP_WORDS[COMP_CWORD-1]}"
  fi

  local slash_commands='${commands}'
  local flags='${flags}'
  local agent_names='${agentNames}'

  if [[ "$prev" == "/agent" ]]; then
    COMPREPLY=( $(compgen -W "$agent_names" -- "$cur") )
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

  return `#compdef icopilot icli

_icopilot() {
  local -a slash_commands
  slash_commands=(${commands})
  local -a agent_names
  agent_names=(${agentNames})

  _arguments \\
${flagSpecs}    '*::arg:->args'

  case $state in
    args)
      if (( CURRENT >= 2 )) && [[ \${words[CURRENT-1]} == /agent ]]; then
        compadd -- $agent_names
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

  return `# PowerShell completion for icopilot and icli
Register-ArgumentCompleter -Native -CommandName icopilot,icli -ScriptBlock {
  param($wordToComplete, $commandAst, $cursorPosition)

  $slashCommands = @(${commands})
  $flags = @(${flags})
  $agentNames = @(${agentNames})
  $elements = @($commandAst.CommandElements | ForEach-Object { $_.Extent.Text })

  if ($elements.Count -ge 2 -and $elements[$elements.Count - 2] -eq '/agent') {
    $candidates = $agentNames
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
