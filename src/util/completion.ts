export interface CompletionContext {
  slashCommands: string[];
  flags: string[];
}

const defaultSlashCommands = [
  'help',
  'clear',
  'new',
  'model',
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
  'export',
  'share',
  'plan',
  'commit',
  'pr',
  'review',
  'issue',
  'branch',
  'index',
  'search',
  'route',
  'undo',
  'redo',
  'cost',
  'snippets',
  'profile',
  'stats',
  'metrics',
  'explain',
  'explain-shell',
  'suggest',
  'generate',
  'summary',
  'agent',
  'explore',
  'compare',
  'env',
  'template',
  'changelog',
  'fix',
  'lint',
  'test',
  'doctor',
  'task',
  'tasks',
  'todo',
  'deps',
  'init',
  'security',
  'refactor',
  'history',
  'bookmark',
  'alias',
  'skill',
  'stash',
  'multi',
  'watch',
  'memory',
  'extension',
  'exit',
  'quit',
];

const defaultFlags = [
  '-p',
  '--prompt',
  '--model',
  '--cwd',
  '--sandbox',
  '--tui',
  '--verbose',
  '--help',
  '--version',
];

export function defaultContext(): CompletionContext {
  return {
    slashCommands: [...defaultSlashCommands],
    flags: [...defaultFlags],
  };
}

export function bashCompletion(ctx: CompletionContext = defaultContext()): string {
  const commands = ctx.slashCommands.map((command) => `/${command}`).map(bashWord).join(' ');
  const flags = ctx.flags.map(bashWord).join(' ');

  return `# bash completion for icopilot and icli
_icopilot() {
  local cur
  COMPREPLY=()

  if type _init_completion >/dev/null 2>&1; then
    _init_completion -n : || return
  else
    cur="\${COMP_WORDS[COMP_CWORD]}"
  fi

  local slash_commands='${commands}'
  local flags='${flags}'

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
  const commands = ctx.slashCommands.map((command) => `/${command}`).map(zshSingleQuoted).join(' ');
  const flagSpecs = ctx.flags.map((flag) => `    ${zshSingleQuoted(`${flag}[icopilot option]`)} \\\n`).join('');

  return `#compdef icopilot icli

_icopilot() {
  local -a slash_commands
  slash_commands=(${commands})

  _arguments \\
${flagSpecs}    '*::arg:->args'

  case $state in
    args)
      if [[ $PREFIX == /* ]]; then
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
  const commands = ctx.slashCommands.map((command) => `/${command}`).map(pwshSingleQuoted).join(', ');
  const flags = ctx.flags.map(pwshSingleQuoted).join(', ');

  return `# PowerShell completion for icopilot and icli
Register-ArgumentCompleter -Native -CommandName icopilot,icli -ScriptBlock {
  param($wordToComplete, $commandAst, $cursorPosition)

  $slashCommands = @(${commands})
  $flags = @(${flags})

  if ($wordToComplete -like '/*') {
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
