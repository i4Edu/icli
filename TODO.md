# iCopilot — Architecture Roadmap

> Implementation checklist. For the forward-looking version plan see
> [`roadmap.md`](./roadmap.md). For release notes see [`CHANGELOG.md`](./CHANGELOG.md).

## Status legend

- ✅ done   🟡 in progress   ⬜ planned

## Phase 1 — Foundation

- ✅ Project skeleton, `package.json`, `tsconfig.json`, bin shim
- ✅ Env loader + config resolver (`src/config.ts`)
- ✅ GitHub Models client via OpenAI SDK pointed at `models.inference.ai.azure.com`

## Phase 2 — Core loop

- ✅ Interactive REPL (`modes/interactive.ts`) with prompt, spinner, streaming render
- ✅ One-shot mode (`-p "..."`) — non-interactive, exit on completion
- ✅ Plan mode — toggle (`/plan`), produces step list, awaits confirmation
- ✅ SIGINT/Ctrl-C graceful abort of in-flight streams (returns to prompt, does not exit)

## Phase 3 — Slash commands

- ✅ `/clear` `/new` — wipe history
- ✅ `/model <name>` — switch downstream model
- ✅ `/cwd <path>` — change repo context
- ✅ `/diff` — `git diff` rendered
- ✅ `/context` — token budget visualization
- ✅ `/compact` — summarize history into bullet digest
- ✅ `/exit` `/quit` — clean shutdown
- ✅ `/plan` — toggle plan mode
- ✅ `/help` — list commands
- ✅ `/sessions` — list and resume saved sessions
- ✅ `/export [md|json] [path]` — export current conversation
- ✅ `/review` — review staged changes
- ✅ `/issue [title]` — draft a GitHub issue from context
- ✅ `/branch <topic>` — scaffold a conventional branch

## Phase 4 — Tools / Agentic execution

- ✅ `@file` reference parsing → context injection
- ✅ Shell command proposal with `[Y/n]` confirmation gate
- ✅ File write/patch proposal with diff preview + confirmation
- ✅ Tool registry exposed to model via OpenAI function-calling
- ✅ `apply_patch` tool with per-hunk selection
- ✅ Multi-file write transactions with rollback
- ✅ Read-only `grep` and `glob` tools
- ✅ Sandbox mode (`--sandbox` / `ICOPILOT_SANDBOX=1`)
- ✅ Policy file (`.icopilot/policy.json`)
- ✅ Always-allow memory per session

## Phase 5 — Git autopilot

- ✅ `/commit` — semantic message from staged diff, offers to commit
- ✅ `/pr` — branch-vs-default-branch markdown PR description
- ✅ `/review` `/issue` `/branch` (see Phase 3)

## Phase 6 — Reliability

- ✅ Exponential backoff on HTTP 429 with cooldown banner
- ✅ Session persistence under `~/.terminal-copilot/sessions/`
- ✅ Token budget warning + auto `/compact` suggestion
- ✅ Structured logging with secret redaction
- ✅ Friendly classified errors for token/network/auth/model failures
- ✅ `~/.icopilotrc.json` config file

## Phase 7 — Quality & Tooling

- ✅ ESLint + Prettier + Vitest + GitHub Actions CI (Node 18/20/22 on Ubuntu + Windows)
- ✅ Theming auto-detect (`NO_COLOR`, CI, non-TTY)
- ✅ Windows prompt polish

## Phase 8 — Extensibility (MCP)

- ✅ MCP stdio client + tool loader (`src/mcp/*`)
- ✅ `~/.icopilot/mcp.json` and `.mcp.json` discovery
- ✅ Namespaced MCP tools (`mcp__<server>__<tool>`)

## Phase 9 — Performance (v0.7)

- ✅ Lazy-load `marked`, `marked-terminal`, `gpt-tokenizer`
- ✅ Worker-thread token counting for inputs ≥ 200 KB
- ✅ Incremental fenced-code highlighting in the streaming sink
- ✅ `npm run perf:cold-start` benchmark harness; documented baselines in `docs/performance.md`

## Phase 10 — Release engineering (v1.0)

- ✅ `docs/api.md` — public API freeze with stability tiers
- ✅ `docs/recipes.md`, `docs/index.md`, `docs/release.md`
- ✅ `scripts/release.mjs` + `scripts/changelog.mjs` + `.github/workflows/release.yml`
- ✅ `tests/smoke/cli.smoke.test.ts` + `scripts/smoke.mjs`
- ✅ LICENSE (MIT), `.npmignore`, `package.json` `files` allowlist
- ✅ Real SVG screenshots in README (`scripts/screenshots.mjs`)

## Phase 11 — Beyond 1.0 (opt-in / extension points)

- ✅ Opt-in TUI mode (`--tui`, no extra deps)
- ✅ Multi-model routing (`/route`, `src/routing/*`)
- ✅ Workspace embeddings index (`/index`, `src/index/*`)
- ✅ Extension-point interfaces for voice (`SpeechProvider`), team mode (`TeamTransport`), and plugin catalog (`PluginCatalog`)
- 📚 Reference architectures for each extension live in `docs/future.md`

## Phase 12 — Productivity & Reach (v1.1)

- ✅ `/undo` & `/redo` — file-write transaction journal (`src/session/undo-journal.ts`)
- ✅ `/cost` — running token + USD cost estimator (`src/util/cost.ts`)
- ✅ `web_fetch` tool — sandboxed HTTP GET with host allowlist (`src/tools/web.ts`)
- ✅ `/snippets` — saved prompt templates (`src/snippets/*`)
- ✅ `/profile` — named config profiles (`src/config-profile.ts`)
- ✅ Shell completion script generator (`scripts/gen-completions.mjs`)
- ✅ `/stats` — local usage counters (`src/stats/*`)
- ✅ `/explain <path>` — quick file/folder summary
- ✅ `/lint` — auto-detect & run project linters
- ✅ `/bookmark` — bookmark/recall conversation positions (`src/session/bookmarks.ts`)

## Phase 13 — Copilot CLI Parity & Beyond (v1.2)

- ✅ `/suggest` — natural-language → shell command suggestion (like `gh copilot suggest`)
- ✅ `/explain-shell <cmd>` — explain an arbitrary shell command in plain English
- ✅ Autopilot mode (`--autopilot`) — multi-step autonomous task execution with plan→act loop
- ✅ `/summary` — workspace/project architectural overview
- ✅ Command safety net — detect dangerous commands, warn before confirmation
- ✅ `/test` — auto-detect and run project test suites
- ✅ `/search` — semantic code search using workspace embeddings
- ✅ `/refactor` — AI-guided refactoring (rename, extract, inline)
- ✅ `/history` — interactive conversation history browser
- ✅ `edit_file` tool — surgical line-range edits without full file rewrite
- ✅ `describe_image` tool — image analysis via multi-modal models
- ✅ `/generate` — shell command generation from natural-language goals
- ✅ `/fix` — AI-powered error troubleshooting prompts
- ✅ `/doctor` — diagnose local iCopilot setup (token, config, git, node)
- ✅ `/init` — scaffold `.icopilot` project configuration
- ✅ `/diff-review` — enhanced diff review (unstaged, staged, branch, range)
- ✅ `/alias` — custom command shortcuts with persistent storage
- ✅ `/multi` — query multiple models in parallel for comparison
- ✅ `/deps` — inspect project dependencies (npm, cargo, go, pip, bundler)
- ✅ `/changelog` — generate changelog from git commits
- ✅ `/env` — show environment context and diagnostics
- ✅ `/template` — scaffold projects from built-in templates
- ✅ `/tokens` — detailed token usage breakdown by message type
- ✅ `/git-log` — visual git log with filtering
- ✅ `/watch` — file watcher configuration
- ✅ `/metrics` — session performance metrics tracking
- ✅ `/security` — scan for secrets and credential leaks
- ✅ `/todo` — session-scoped task tracking with persistence
- ✅ `/stash` — stash/restore conversation state
- ✅ `/compare` — side-by-side file comparison with AI prompt

## Phase 14 — Agent Runtime & Extensibility (v1.3) ✅

- ✅ `--autopilot` CLI flag — wire autopilot mode to entry point
- ✅ Safety net integration — `checkCommandSafety()` in shell tool
- ✅ `/pin` `/unpin` — wire PinnedContext into sessions + slash commands
- ✅ Auto-compact — automatic context compaction at 95% budget
- ✅ `--json` flag — structured output for scripting
- ✅ `--quiet` / `-q` — suppress decorative output
- ✅ `--yes` / `--no-confirm` — auto-approve for CI/CD
- ✅ `/skill` — agent skill management (load, activate, deactivate)
- ✅ `/extension` — extension loader with manifest.json discovery
- ✅ `/agent` — delegate to specialized sub-agents (explore, task, review, plan)
- ✅ `/explore` — codebase exploration with project context
- ✅ Background tasks — `/task` management for long-running operations
- ✅ `/memory` — persistent project memory across sessions
- ✅ `/share` — session export/import bundles
- ✅ Enhanced `/context` — full breakdown by source with trim suggestions
- ✅ Version bump to 1.3.0

## Phase 15 — Multi-Agent Orchestration (v1.4) ✅

- ✅ Parallel agent runner — concurrent sub-agent execution
- ✅ `&` suffix syntax — background any prompt
- ✅ Agent result aggregation — merged multi-agent output
- ✅ Custom agent definitions — `.icopilot/agents/*.yaml`
- ✅ Agent routing — automatic delegation by query type
- ✅ `run_in_terminal` tool — interactive PTY command execution
- ✅ `list_directory` tool — structured directory listing
- ✅ `search_symbols` tool — AST-aware symbol search
- ✅ Tool retry logic — automatic retry on transient failures

## Phase 16 — Copilot Spaces & Teams (v1.5) ✅

- ✅ Project spaces — isolated context sandboxes per project/branch
- ✅ Space configuration — `.icopilot/space.yaml`
- ✅ `/space` command — switch context workspace
- ✅ Session handoff — export state for another developer
- ✅ Shared team memory — `.icopilot/team-memory.md`
- ✅ Smart file selection — model-driven relevant file picking
- ✅ Git-aware context — auto-include recently modified files
- ✅ Dependency-aware context — follow imports to include related files
- ✅ Context priority scoring — relevance-ranked sources

## Phase 17 — IDE-Grade Intelligence (v1.6) ✅

- ✅ Tree-sitter integration — AST parsing
- ✅ Symbol index — project-wide function/class/type table
- ✅ Cross-file navigation — go-to-definition, find-references
- ✅ Type-aware refactoring — rename across all usages
- ✅ Multi-file atomic edits — N-file changes reviewed holistically
- ✅ Code generation with tests — auto-generate test file for new modules
- ✅ Live error watching — monitor build output, auto-suggest fixes
- ✅ Stack trace analysis — AI-powered root cause diagnosis
- ✅ Dead code detection — identify unused exports/functions

## Phase 18 — Workflow Automation (v1.7) ✅

- ✅ Workflow definitions — `.icopilot/workflows/*.yaml`
- ✅ Built-in workflows — review-and-commit, test-fix-loop, release-prep
- ✅ Conditional steps + loop constructs
- ✅ GitHub Actions helper — generate workflow YAML from natural language
- ✅ Pre-commit hook — `/review` + `/security` before commit
- ✅ File watch triggers — run workflow on change
- ✅ Release automation — version bump → changelog → tag → publish

## Phase 19 — Knowledge & Learning (v1.8) ✅

- ✅ Project RAG — chunk and index all docs for retrieval
- ✅ External docs ingestion — API docs, framework guides
- ✅ `/doc` command — generate JSDoc/docstring
- ✅ README generation — scaffold from project analysis
- ✅ Architecture diagrams — mermaid from code relationships
- ✅ Style learning — adapt to user's coding patterns
- ✅ Correction memory — remember user corrections
- ✅ Project conventions — learn and enforce patterns

## Phase 20 — Enterprise & Security (v1.9) ✅

- ✅ Role-based tool access — restrict by user role
- ✅ Audit logging — full trail of tool executions
- ✅ SSO support — SAML/OIDC authentication
- ✅ Proxy support — HTTP/HTTPS/SOCKS5
- ✅ Air-gapped mode — local models (Ollama, vLLM)
- ✅ Content filtering — prevent PII in prompts
- ✅ Retention policies — auto-delete after N days

## Phase 21 — The Complete Agentic OS (v2.0) ✅

- ✅ Goal-driven development — describe feature → implement end-to-end
- ✅ Self-healing builds — detect failure → diagnose → fix → retry
- ✅ Test-driven agent — write tests first, implement until green
- ✅ Multi-repo orchestration — coordinate across repositories
- ✅ Plugin marketplace — `icopilot install <plugin>`
- ✅ Custom model providers — any OpenAI-compatible endpoint
- ✅ IDE bridge — bidirectional VS Code / Neovim communication
- ✅ API server mode — expose as HTTP API
- ✅ Container sandbox — Docker-based isolated execution
- ✅ Cloud sessions — run in cloud, access from any terminal
