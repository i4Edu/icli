<h1 align="center">
  <img src="https://raw.githubusercontent.com/i4Edu/icli/main/docs/screenshots/repl.svg" alt="" width="1" height="1">
  iCopilot · icli
</h1>

<p align="center">
  <strong>Terminal-native agentic AI assistant — powered by GitHub Models</strong><br>
  <em>Interactive REPL · Plan Mode · Autopilot · Multi-Agent · IDE Bridge · API Server</em>
</p>

<p align="center">
  <a href="https://www.npmjs.com/package/icopilot"><img src="https://img.shields.io/npm/v/icopilot?color=0078d4&label=npm&style=flat-square" alt="npm"></a>
  <a href="https://www.npmjs.com/package/icopilot"><img src="https://img.shields.io/npm/dm/icopilot?color=28a745&style=flat-square" alt="downloads"></a>
  <img src="https://img.shields.io/badge/node-%3E%3D18.17-brightgreen?style=flat-square" alt="node">
  <img src="https://img.shields.io/badge/license-MIT-blue?style=flat-square" alt="license">
</p>

---

## Screenshots

<p align="center">
  <img src="./docs/screenshots/repl.svg" alt="iCopilot interactive REPL" width="820">
  <br><em>Interactive REPL with live streaming responses and tool confirmations</em>
</p>

<p align="center">
  <img src="./docs/screenshots/help.svg" alt="icopilot --help" width="820">
  <br><em>Full CLI reference — <code>icopilot --help</code> or <code>icli --help</code></em>
</p>

<p align="center">
  <img src="./docs/screenshots/oneshot.svg" alt="One-shot mode" width="820">
  <br><em>One-shot mode: pipe-friendly, scriptable AI answers</em>
</p>

<p align="center">
  <img src="./docs/screenshots/missing-token.svg" alt="Friendly auth error" width="820">
  <br><em>Actionable error messages — never silent failures</em>
</p>

---

## Install

```bash
npm install -g icopilot
```

Both `icopilot` and `icli` are installed as identical aliases:

```
$ icopilot --version
2.2.1

$ icli --version
2.2.1
```

**Requirements:** Node.js ≥ 18.17

---

## Authentication

Create a GitHub Personal Access Token with **`models:read`** scope at  
→ [github.com/settings/tokens](https://github.com/settings/tokens)

```bash
# bash / zsh
export GITHUB_TOKEN=ghp_xxxxxxxxxxxx

# PowerShell
$env:GITHUB_TOKEN = "ghp_xxxxxxxxxxxx"

# Persist in ~/.icopilotrc.json
echo '{ "token": "ghp_xxxxxxxxxxxx" }' > ~/.icopilotrc.json
```

---

## Quick Start

```bash
# Start interactive REPL
icopilot

# One-shot — answer a question and exit
icopilot -p "What does @src/index.ts export?"

# Plan mode — AI explains steps before making changes
icopilot --plan

# Autopilot — no confirmations, fully autonomous
icopilot --autopilot -p "Add error handling to all API calls"

# Use a specific model
icopilot --model gpt-4o

# Use local Ollama
icopilot --local

# Start HTTP API server
icopilot --serve 3000

# icli works exactly the same
icli --plan
icli -p "Explain this codebase"
```

---

## CLI Reference

```
Usage: icopilot [options] [command]

Options:
  -p, --prompt <text>          one-shot mode: run a single prompt and exit
  -m, --model <name>           model id (default: gpt-4o-mini)
  --local                      use local Ollama provider
  --provider <name>            github | ollama | vllm | lmstudio | openai | anthropic
  --base-url <url>             override provider base URL
  --plan                       start in Plan Mode
  --autopilot                  run in autopilot mode (no confirmations)
  --architect                  planner + coder dual-agent mode
  --tui                        full-screen TUI interface
  --cwd <path>                 set working directory
  -v, --verbose                enable verbose debug logging
  --sandbox                    restrict tools to current working directory
  --log-level <level>          debug | info | warn | error
  --no-color                   disable colors
  --theme <name>               auto | light | dark | none
  --policy <file>              load a RBAC policy file
  --json                       output responses as JSON
  -q, --quiet                  suppress banners
  -y, --yes                    auto-approve non-critical confirmations
  --serve [port]               start HTTP API server
  --browser [port]             start API server and open browser UI
  --perf-trace                 print cold-start timing

Commands:
  install <plugin>             install a marketplace plugin
  hook [subcommand]            manage the git pre-commit hook
```

---

## Slash Commands (inside the REPL)

Type `/` inside the REPL to trigger any command:

| Category | Commands |
|---|---|
| **Navigation** | `/help` `/clear` `/exit` `/quit` |
| **Models** | `/model <id>` `/provider <name>` `/reasoning` `/think-tokens` |
| **Context** | `/context` `/usage` `/compact` `/pin` `/unpin` `/read-only` `/cwd` |
| **Files** | `/diff` `/changes` `/edit-format` `/editor` |
| **Session** | `/sessions` `/export` `/share` `/handoff` `/copy` `/paste` `/copy-context` |
| **Git** | `/commit` `/pr` `/review` `/diff-review` `/issue` `/branch` `/git-log` |
| **Agents** | `/plan` `/autopilot` `/goal` `/heal` `/tdd` `/architect` |
| **Code Intel** | `/index` `/search` `/goto` `/refs` `/dead-code` `/error-watch` `/stack-trace` |
| **Automation** | `/workflow` `/actions` `/release` `/schedule` `/every` `/after` `/trigger` |
| **Knowledge** | `/rag` `/doc` `/diagram` `/readme` `/conventions` `/corrections` `/memory` `/style` |
| **Teams** | `/space` `/team-memory` `/repo` `/multi` |
| **System** | `/settings` `/profile` `/role` `/sandbox` `/serve` `/acp` `/cloud` `/cloud-routine` |
| **Misc** | `/tokens` `/cost` `/stats` `/metrics` `/snippets` `/feedback` `/voice` `/web` |

---

## Modes

### Interactive REPL
```bash
icopilot        # or: icli
```
The default mode. Streams markdown responses, shows tool proposals with `[Y/n]` confirmations,
tracks token usage, and persists sessions automatically.

```
> Refactor @src/api/github-models.ts to add retry logic
> /review
> /commit
```

### Plan Mode
```bash
icopilot --plan   # or: icli --plan
```
Before making any changes, the AI produces a numbered plan for your review. Approve each step
before it executes. Ideal for complex multi-file refactors.

### Autopilot
```bash
icopilot --autopilot -p "Add input validation to all form handlers"
```
Fully autonomous — the AI plans, implements, tests, and commits without prompts.
Use `--sandbox` to restrict filesystem access to `cwd`.

### Architect Mode
```bash
icopilot --architect
```
Dual-agent: a Planner agent produces a spec, then a Coder agent implements it step by step.

### One-shot (scriptable)
```bash
icopilot -p "What is the cyclomatic complexity of src/index.ts?"
icopilot -p "Explain @package.json" --json
git diff | icopilot -p "Summarize these changes"
```

### API Server
```bash
icopilot --serve 3000
# POST http://localhost:3000/v1/chat/completions
```

---

## @file References

Mention any file with `@` to inject its content into context:

```
> Review @src/auth/jwt.ts for security issues
> Compare @src/v1/api.ts and @src/v2/api.ts
> What changed in @package.json recently?
```

Supports glob patterns: `@src/**/*.ts`

---

## Configuration

**`~/.icopilotrc.json`** (user-level defaults):
```json
{
  "token": "ghp_...",
  "defaultModel": "gpt-4o-mini",
  "endpoint": "https://models.inference.ai.azure.com",
  "theme": "auto",
  "verbose": false,
  "sandbox": false
}
```

**Environment variables:**

| Variable | Description |
|---|---|
| `GITHUB_TOKEN` or `ICOPILOT_TOKEN` | API authentication token |
| `ICOPILOT_MODEL` | Default model ID |
| `ICOPILOT_ENDPOINT` | API endpoint override |
| `ICOPILOT_SESSION_DIR` | Custom session storage path |
| `ICOPILOT_THEME` | `auto` \| `light` \| `dark` \| `none` |
| `ICOPILOT_LOG_LEVEL` | `debug` \| `info` \| `warn` \| `error` |
| `ICOPILOT_SANDBOX` | `true` to restrict tools to cwd |

**Project memory** — `.icopilot/memory.md` (committed, shared)  
**Global memory** — `~/.icopilot/memory.md` (personal, cross-project)

---

## Agentic Capabilities

### Goal-Driven Development
Describe a feature at a high level — the AI breaks it down, implements it, runs tests, and iterates:
```
> /goal "Add OAuth2 login with GitHub"
```

### Self-Healing Builds
```
> /heal
```
Detects build/test failures, diagnoses root cause, applies fixes, retries automatically.

### TDD Agent
```
> /tdd "Write a rate limiter with sliding window"
```
Writes tests first, implements code until all tests pass.

### Multi-File Atomic Edits
The AI can read, reason about, and edit N files in a single coherent operation — no context loss.

### Pre-commit Hook
```bash
icopilot hook install
```
Runs `/review` and `/security` scan before every `git commit`.

---

## Model Support

| Provider | Models |
|---|---|
| **GitHub Models** (default) | `gpt-4o`, `gpt-4o-mini`, `o1`, `o1-mini`, `o3-mini`, `claude-3.5-sonnet`, `Llama-3.3-70B`, and more |
| **Ollama** | any locally-served model |
| **vLLM / LM Studio** | any OpenAI-compatible endpoint |
| **OpenAI** | direct API |
| **Anthropic** | direct API |
| **Custom** | any provider in `.icopilot/providers/*.yaml` |

Switch models at runtime:
```
> /model gpt-4o
> /provider anthropic
```

---

## Plugin System

```bash
icopilot install <plugin-name>    # install from marketplace
/plugins list                     # list installed plugins
/extension load ./my-plugin.js    # load local extension
```

---

## Architecture

```
src/
├── index.ts              ← CLI entry, flag parsing
├── config.ts             ← env + rc-file + runtime config
├── api/github-models.ts  ← OpenAI-SDK → GitHub Models
├── session/              ← history, persistence, handoff, cloud
├── context/              ← @file, /compact, memory, smart-files, git context
├── tools/                ← shell, file ops, patch, grep, glob, multi-edit
├── commands/             ← 60+ slash command handlers
├── agents/               ← parallel runner, router, goal, TDD, self-heal
├── intelligence/         ← symbol index, navigation, error watch, dead code
├── workflows/            ← YAML engine, file triggers, built-ins
├── knowledge/            ← RAG, style learner, corrections, conventions
├── security/             ← RBAC, audit, content filter, retention, proxy
├── providers/            ← custom providers, local models
├── plugins/              ← marketplace, loader
├── server/               ← HTTP API server
├── bridge/               ← VS Code / Neovim IDE bridge
├── sandbox/              ← container-based isolated execution
├── spaces/               ← project spaces
├── hooks/                ← pre-commit, git hooks
├── ui/                   ← streaming markdown, theme, prompt
└── modes/                ← interactive / plan / oneshot / TUI
```

---

## Documentation

| Doc | Description |
|---|---|
| [`docs/config.md`](./docs/config.md) | Full config file reference |
| [`docs/sessions.md`](./docs/sessions.md) | Session management & memory |
| [`docs/mcp.md`](./docs/mcp.md) | MCP server integration |
| [`docs/api.md`](./docs/api.md) | HTTP API server reference |
| [`docs/teams-integration.md`](./docs/teams-integration.md) | Teams & spaces |
| [`docs/cloud-routines.md`](./docs/cloud-routines.md) | Scheduled cloud routines |
| [`CHANGELOG.md`](./CHANGELOG.md) | Release notes |
| [`roadmap.md`](./roadmap.md) | Version roadmap |

---

## License

MIT © [i4Edu](https://github.com/i4Edu)
