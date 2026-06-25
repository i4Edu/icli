# iCopilot

A terminal-native, agentic CLI assistant — fully replicating and enhancing
the modern GitHub Copilot CLI experience, powered exclusively by the
**GitHub Models API**.

## Features

- 🗣️  **Interactive REPL** with live, streaming markdown responses
- 🧭  **Plan Mode** — produces step lists for review before any change
- ⚡  **One-shot mode** — `icopilot -p "..."` for scripting / piping
- 📎  **`@file` references** auto-inject file contents into context
- 🛠️  **Agentic tools** — shell + file edits gated by `[Y/n]` confirmation
- ⌘   **Slash commands** — `/clear /model /cwd /diff /context /compact /sessions /export /commit /pr /review /issue /branch /plan /help /exit`
- 🧠  **Token budget** tracker with auto-suggest `/compact`
- 💾  **Session persistence** under `~/.terminal-copilot/sessions/` (resume via `/sessions`)
- 🪶  **Graceful SIGINT** — Ctrl-C aborts a stream, never the app
- 🔁  **HTTP 429 backoff** with cooldown banners
- 🧰  **Apply-patch / grep / glob** read & edit tools, plus multi-file write transactions
- 🛡️  **Sandbox + policy** — `--sandbox` and `.icopilot/policy.json` allow/deny lists
- 🧩  **MCP support** — load tools from Model Context Protocol servers

## Install

```bash
npm install
npm run build
npm link        # exposes `icopilot` / `icli` globally
```

## Auth

Set a GitHub PAT with `models:read`:

```bash
# bash / zsh
export GITHUB_TOKEN=ghp_xxx...

# PowerShell
$env:GITHUB_TOKEN = "ghp_xxx..."
```

Optional:

```bash
ICOPILOT_MODEL=gpt-4o          # default model
ICOPILOT_ENDPOINT=https://models.inference.ai.azure.com
```

## Usage

```bash
icopilot                                   # interactive REPL
icopilot -p "Explain @src/index.ts"        # one-shot
icopilot --model gpt-4o                    # pin model
icopilot --plan                            # start in plan mode
icopilot --sandbox                         # restrict tools to cwd
icopilot --verbose --log-level debug       # structured logs to stderr
icopilot --theme light                     # light / dark / none
```

See [`docs/config.md`](./docs/config.md) for the full config-file format,
[`docs/sessions.md`](./docs/sessions.md) for session/memory usage, and
[`docs/mcp.md`](./docs/mcp.md) for MCP server integration.

Inside the REPL:

```
> /help
> /model gpt-4o-mini
> Refactor @src/api/github-models.ts to add caching
> /review
> /commit
> /pr
> /sessions
> /export md
> /exit
```

## Architecture

```
src/
├── index.ts              # entry / CLI flag parsing
├── config.ts             # env + rc-file + runtime config
├── logger.ts             # structured logging + secret redaction
├── api/github-models.ts  # OpenAI-SDK client → GitHub Models
├── session/              # history, persistence, multi-session manager
├── context/              # @file parser, /compact summarizer, project memory
├── tools/                # shell, file ops, apply_patch, grep, glob, policy, sandbox
├── mcp/                  # Model Context Protocol client + loader
├── commands/             # slash dispatcher, git autopilot, /review /issue /branch
├── ui/                   # streaming markdown render, theme, prompt
└── modes/                # interactive / plan / oneshot
```

See [`roadmap.md`](./roadmap.md) for the version plan, [`TODO.md`](./TODO.md)
for the implementation checklist, and [`CHANGELOG.md`](./CHANGELOG.md) for
release notes.
