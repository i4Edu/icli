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

## Phase 18 — Workflow Automation (v1.7) ✅

- ✅ Workflow definitions — `.icopilot/workflows/*.yaml` declarative task chains
- ✅ Built-in workflows — `review-and-commit`, `test-fix-loop`, `release-prep`
- ✅ Conditional steps — if/then/else based on tool outputs
- ✅ Loop constructs — repeat steps until condition met
- ✅ GitHub Actions helper — generate/edit workflow YAML from natural language
- ✅ Pipeline debugging — analyze CI failure logs and suggest fixes
- ✅ Pre-commit hook — optional git hook running `/review` + `/security` before commit

## Phase 19 — Knowledge & Learning (v1.8) ✅

- ✅ Knowledge graph — project-wide entity/relationship graph
- ✅ Semantic code search — natural language queries over codebase
- ✅ Learning system — track successful approaches, prefer them in future
- ✅ Pattern recognition — detect recurring code patterns and suggest abstractions
- ✅ Documentation generation — auto-generate docs from code analysis

## Phase 20 — Enterprise & Security (v1.9) ✅

- ✅ Audit logging — structured logs for compliance
- ✅ Policy enforcement — organization-level guardrails
- ✅ Secrets detection — scan for leaked credentials/tokens
- ✅ RBAC integration — role-based command access
- ✅ Compliance reporting — generate security/compliance reports

## Phase 21 — The Complete Agentic OS (v2.0) ✅

- ✅ Goal-driven development — end-to-end feature implementation
- ✅ Self-healing builds — detect, diagnose, fix build failures automatically
- ✅ Test-driven agent — write tests first, implement until green
- ✅ Multi-repo orchestration — coordinate changes across repositories
- ✅ Chain-of-thought planning — visible reasoning with intervention points
- ✅ Custom model providers — plug in any OpenAI-compatible endpoint
- ✅ API server mode — expose iCopilot as HTTP API
- ✅ Multi-language REPL — execute Python/JS/Rust snippets inline

## Phase 22 — Competitive Parity (v2.1) ✅

- ✅ Image input — vision model detection, base64 encoding, screenshot context
- ✅ Git undo — AI commit tracking, `git reset --soft`, safety guards
- ✅ Web scraping — `/web <url> [focus]`, HTML→markdown, truncation
- ✅ Lifecycle hooks — 10 event types, preToolUse deny/modify, JSON stdin/stdout
- ✅ Diff-based editing — SEARCH/REPLACE parsing, fuzzy matching, `/edit-format`
- ✅ External editor — `$VISUAL`/`$EDITOR` detection, `.md` temp files
- ✅ Reasoning control — `/reasoning`, `/think-tokens`, API wiring
- ✅ Auto-lint & auto-test — run linter/tests after AI edits, auto-fix loop
- ✅ Per-message mode switching — `/ask`, `/code`, `/architect` prefixes
- ✅ Mid-session diff — `/changes` with per-turn git snapshots
- ✅ Runtime settings — `/settings KEY VALUE`, `~/.icopilotrc.json` persistence
- ✅ User feedback — `/feedback` with offline storage, optional GitHub issue
- ✅ Context visualization — visual `/context` usage view + `/usage` alias
- ✅ Auto-memory — AI self-learning with 28-day retention, `/memory auto`
- ✅ Scheduled prompts — `/every`, `/after` for recurring/delayed tasks
- ✅ Read-only files — `/read-only` with file protection
- ✅ Clipboard operations — `/paste`, `/copy-context`, `/run` with output injection
- ✅ Dead code detection — identify unused exports/functions

## Phase 23 — Platform & Ecosystem (v2.2) ✅

- ✅ Browser/web UI — `--browser` flag and API web shell
- ✅ Architect mode — dual-model planner + coder flow
- ✅ Git worktrees — `/worktree` command for list/add/remove/prune
- ✅ Voice input — speech-to-text for hands-free interaction via `/voice` command
- ✅ ACP protocol server — Agent Client Protocol for tool interop
- ✅ Cloud-scheduled routines — remote cron-like task execution
- ✅ Vi/Emacs keybindings — modal editing in the REPL
- ✅ Slack/Teams integration — receive notifications and approve actions

## Phase 24 — Observability & Team Quality (v2.3) ⬜

- ⬜ Reasoning trace view (`/trace` command with per-step tool/model timeline)
- ⬜ Token attribution by command (surface top token/cost drivers in `/tokens` + `/cost`)
- ⬜ Model comparison runs (same prompt across selected models with diff summary)
- ⬜ Output quality scoring (confidence + risk signal for tool/file actions)
- ⬜ Batch prompt execution (`/batch <file>` with progress and result export)

## Phase 25 — Admin & Governance (v2.4) ⬜

- ⬜ Organization config layer (`.icopilot/org.yaml` inherited defaults + policy)
- ⬜ Role-based access controls (command/tool allowlist per role)
- ⬜ Centralized audit stream (structured events to external sink)
- ⬜ Token/cost quotas (per-user and per-project budget enforcement)
- ⬜ Compliance profiles (SOC2/HIPAA-style policy presets)

## Phase 26 — Integration Hub (v2.5) ⬜

- ⬜ Jira/Linear integration (link sessions to tickets, sync status)
- ⬜ Observability connectors (Datadog/Splunk/OpenTelemetry export)
- ⬜ Deployment metadata hooks (attach CI/release context to sessions)
- ⬜ External knowledge connectors (ingest docs/wiki for retrieval)
- ⬜ Remote execution targets (SSH/container/cloud runner routing)

## Phase 27 — Enterprise Agent Platform (v3.0) ⬜

- ⬜ Workspace tenancy (team/project-scoped memory and policy isolation)
- ⬜ Approval workflows (configurable human gates for risky operations)
- ⬜ SLO-aware automations (runbooks for CI failures and incident triage)
- ⬜ Fleet policy rollout (central versioning for skills/workflows/policies)
- ⬜ Cross-repo orchestration hardening (reliable multi-repo coordination)

## Phase 28 — Adaptive Multi-Agent Intelligence (v3.5) ⬜

- ⬜ Plan refinement loops (iterative decomposition before execution)
- ⬜ Dependency-aware scheduling (task graph based parallel execution)
- ⬜ Self-recovery strategies (backtracking + alternative-path retries)
- ⬜ Consensus reasoning (multi-model or multi-agent conflict resolution)
- ⬜ Outcome learning (learn preferred strategies from execution traces)

## Phase 29 — Autonomous Software Delivery OS (v4.0) ⬜

- ⬜ Goal-to-release pipeline (plan → code → test → release assets)
- ⬜ Continuous self-verification (automatic lint/test/security loops)
- ⬜ Self-documenting delivery (ADRs, API docs, changelog generation)
- ⬜ Incident-aware operations (detect, triage, and propose remediations)
- ⬜ Universal execution fabric (local/container/cloud execution orchestration)
