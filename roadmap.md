# iCopilot — Roadmap

> Forward-looking roadmap for **iCopilot** (`icopilot` / `icli`), a terminal-native
> agentic CLI powered exclusively by the **GitHub Models API**.
> 
> For the historical/implementation checklist see [`TODO.md`](./TODO.md).

## Legend

| Symbol | Meaning |
| --- | --- |
| ✅ | Shipped |
| 🟡 | In progress |
| ⬜ | Planned |
| 💡 | Idea / exploring |

---

## v0.1 — Foundation (shipped) ✅

The current released baseline.

- ✅ Streaming REPL + one-shot (`-p`) modes
- ✅ Plan mode with confirm-before-act semantics
- ✅ Slash commands: `/clear /model /cwd /diff /context /compact /commit /pr /plan /help /exit`
- ✅ `@file` context injection
- ✅ Shell + file-edit tools gated by `[Y/n]` confirmation
- ✅ Token-budget tracker with auto `/compact` suggestion
- ✅ Session persistence under `~/.terminal-copilot/sessions/`
- ✅ HTTP 429 exponential backoff
- ✅ Graceful SIGINT (abort stream, keep app alive)

---

## v0.2 — Quality & DX ✅

- ✅ **Test suite** — Vitest unit tests for `context/`, `tools/`, `session/`, `commands/`
- ✅ **Lint + format** — ESLint (typescript-eslint) + Prettier, CI gate
- ✅ **CI** — GitHub Actions: lint → typecheck → test → build matrix (Node 18/20/22 on Ubuntu + Windows)
- ✅ **Structured logging** — `--verbose` / `ICOPILOT_DEBUG=1` with redaction of tokens
- ✅ **Error surfaces** — friendly messages for missing `GITHUB_TOKEN`, network, 401/403, unknown model
- ✅ **Config file** — `~/.icopilotrc.json` merging with env + flags
- ✅ **Theming** — light/dark/no-color auto-detect; `ICOPILOT_THEME=`
- ✅ **Windows polish** — PowerShell/CMD prompt rendering and path handling parity

---

## v0.3 — Tooling & Agentic Power ✅

- ✅ **Apply-patch tool** — model emits unified diff; user picks hunks to apply
- ✅ **Multi-file edit transactions** — preview all changes, atomic accept/reject with rollback
- ✅ **Read-only `grep` / `glob` tools** — let the model search the repo itself
- ✅ **Workspace sandbox** — opt-in `--sandbox` to restrict shell + write tools to cwd
- ✅ **Tool allowlist / denylist** — per-project `.icopilot/policy.json`
- ✅ **Always-allow** memory for trusted commands within a session

---

## v0.4 — Extensibility (MCP) ✅

- ✅ **MCP client** — load tools from Model Context Protocol servers
- ✅ `~/.icopilot/mcp.json` registry, per-server allow rules
- ✅ Auto-discovery of repo-local `.mcp.json`
- ✅ Tool namespacing (`mcp__<server>__<tool>`) + collision handling
- 💡 Built-in MCP servers for `github`, `filesystem`, `fetch` *(deferred)*

---

## v0.5 — Sessions & Memory ✅

- ✅ **Multi-session switcher** — `/sessions`, picker, resume by id
- ✅ **Per-project memory** — `.icopilot/memory.md` auto-loaded (also global `~/.icopilot/memory.md`)
- ✅ **Auto-summarizing history** — `shouldAutoSummarize()` threshold helper, manual `/compact` still available
- ✅ **Export / share** — `/export md|json` of a conversation

---

## v0.6 — Git & Collaboration ✅

Build on `/commit` and `/pr`.

- ✅ `/review` — review staged diff, surface risks & suggestions
- ✅ `/issue` — draft a GitHub issue from current context
- ✅ `/branch <topic>` — checkout + scaffold conventional branch
- ✅ `gh` CLI integration when available (open PR, attach labels)
- 💡 Auto-link commits/PRs back to GitHub Models telemetry *(deferred)*

---

## v0.7 — Performance ✅

- ✅ Lazy-load heavy deps (`marked` / `marked-terminal` via `src/ui/render.ts`; `gpt-tokenizer` via `src/util/tokens.ts`)
- ✅ Token counting in a worker thread for large `@file` injections (`src/util/token-worker.ts`, ≥200 KB threshold)
- ✅ Streamed markdown renderer with incremental fenced-code highlighting (`StreamSink` in `src/ui/render.ts`)
- 🟡 Cold-start budget — `npm run perf:cold-start` measures it; the original `< 150 ms` goal was unrealistic on Windows ESM Node (current median ≈ 2.1 s, dominated by `commander` + `openai` + `chalk` resolution). Target revised to **`< 800 ms` on Linux/Node 20**; tracked in `docs/performance.md`.

---

## v1.0 — Stable Release ✅

Criteria met:

- ✅ All v0.2–v0.4 items complete
- ✅ Public API for tools, slash commands, and MCP documented (`docs/api.md` with stability tiers)
- ✅ End-to-end smoke tests on Linux / macOS / Windows (`tests/smoke/cli.smoke.test.ts` + `npm run smoke`, run by CI on all OSes)
- ✅ Release automation — `scripts/release.mjs`, `scripts/changelog.mjs`, tag-triggered `.github/workflows/release.yml` with `npm publish --provenance`
- ✅ Documentation site (`docs/index.md` with config / sessions / mcp / routing / indexing / performance / tui / api / recipes / release / future)
- ✅ Semantic-versioning + CHANGELOG.md automation

> The actual `npm publish` is a manual one-time setup step (NPM\_TOKEN secret + first publish). The pipeline is end-to-end ready.

---

## Beyond 1.0 — Exploration ✅ / 💡

- ✅ **TUI mode** — `--tui` opt-in full-screen mode (`src/modes/tui.ts`, `src/ui/screen.ts`, no extra deps; ANSI alternate-screen with chat / input panes)
- ✅ **Workspace indexing** — embeddings cache for repo-wide retrieval (`src/index/*`, `/index build|status|search`)
- ✅ **Multi-model routing** — cheap model for planning, strong model for edits (`src/routing/*`, `/route get|set|list`)
- ✅ **Voice input** — extension-point interface shipped (`src/extensions/voice.ts`); reference implementations documented in `docs/future.md`
- ✅ **Team mode** — `TeamTransport` extension-point shipped (`src/extensions/team.ts`); WebRTC + signalling reference architectures in `docs/future.md`
- ✅ **Plugin marketplace** — `PluginCatalog` extension-point + `LocalPluginCatalog` default (`src/extensions/marketplace.ts`); GitHub-Pages-hosted catalog pattern in `docs/future.md`

The exploration extension points are intentionally minimal: a third party can `import { registerSpeechProvider } from 'icopilot/dist/extensions/voice.js'` from a sibling npm package and plug a real implementation in without forking iCopilot.

---

## v1.1 — Productivity & Reach ✅

Ten focused enhancements that broaden the day-to-day surface area of
iCopilot without changing its core philosophy (terminal-first, GitHub
Models only, opt-in everything).

- ✅ **`/undo` & `/redo`** — transaction journal of file writes (`src/session/undo-journal.ts`); restore previous bytes on demand
- ✅ **`/cost`** — running token + estimated USD cost per session, with per-model rate table (`src/util/cost.ts`)
- ✅ **`web_fetch` tool** — sandboxed HTTP GET tool with host allow/deny list (`src/tools/web.ts`)
- ✅ **`/snippets`** — save / list / insert reusable prompt templates from `~/.icopilot/snippets/` (`src/snippets/*`)
- ✅ **`/profile`** — named config profiles (model + theme + sandbox preset) (`src/config-profile.ts`)
- ✅ **Shell completions** — generated bash / zsh / pwsh completion scripts (`scripts/gen-completions.mjs`)
- ✅ **`/stats`** — local-only usage counters (tokens, tool calls, commands) persisted under `~/.icopilot/stats.json`
- ✅ **`/explain <path>`** — quick one-shot file/folder summary using the cheap routed model
- ✅ **`/lint`** — auto-detect project linters (`eslint`, `ruff`, `golangci-lint`…) and run them in the sandbox
- ✅ **`/bookmark`** — bookmark a message in history; `/bookmark go <name>` rewinds context to that point

Each item is implemented as a self-contained module with its own
Vitest unit tests; integration is performed by editing the slash
dispatcher (`src/commands/slash.ts`) and the tool registry
(`src/tools/registry.ts`) once per feature.

---

## v1.2 — Copilot CLI Parity & Beyond ✅

Thirty features that bring iCopilot to feature-parity with GitHub's `gh copilot`
CLI and beyond — making it a true agentic terminal assistant.

**Copilot CLI parity:**
- ✅ **`/suggest`** — natural-language → shell command translation (like `gh copilot suggest`)
- ✅ **`/explain-shell <cmd>`** — explain any shell command in plain English, highlight risks
- ✅ **`/generate <goal>`** — generate shell commands from natural-language goals

**Autonomous execution:**
- ✅ **Autopilot mode** — `--autopilot` flag; multi-step autonomous plan→act→verify loop (`src/modes/autopilot.ts`)
- ✅ **Command safety net** — intercept dangerous patterns (`rm -rf /`, `DROP TABLE`, force pushes) with extra confirmation (`src/tools/safety.ts`)

**Code intelligence:**
- ✅ **`/search`** — semantic code search using workspace embeddings index
- ✅ **`/refactor`** — AI-guided refactoring flows: rename symbol, extract function, inline variable
- ✅ **`/summary`** — workspace/project architectural overview
- ✅ **`/compare <a> <b>`** — side-by-side file comparison with AI analysis prompt
- ✅ **`edit_file` tool** — surgical line-range edit tool; model specifies line range + new content
- ✅ **`describe_image` tool** — image analysis via multi-modal models

**Git & project intelligence:**
- ✅ **`/diff-review`** — enhanced diff review (unstaged, staged, branch, commit range, file)
- ✅ **`/changelog`** — generate changelog from git commit history
- ✅ **`/git-log`** — visual git log with author/date/count filtering
- ✅ **`/security`** — scan workspace for secrets and credential leaks
- ✅ **`/deps`** — inspect project dependencies (npm, yarn, pnpm, cargo, go, pip, bundler)

**Development workflow:**
- ✅ **`/test`** — auto-detect project test frameworks and run them
- ✅ **`/fix <error>`** — AI-powered error troubleshooting prompts
- ✅ **`/init`** — scaffold `.icopilot` project configuration
- ✅ **`/doctor`** — diagnose local iCopilot setup (token, config, git, node)
- ✅ **`/template`** — scaffold projects from built-in templates (node-ts, express, react, fastapi)

**Session & productivity:**
- ✅ **`/history`** — interactive conversation history browser with search
- ✅ **`/todo`** — session-scoped task tracking with persistence
- ✅ **`/stash`** — stash/restore conversation state (push, pop, list, drop, clear)
- ✅ **`/tokens`** — detailed token usage breakdown by message type
- ✅ **`/metrics`** — session performance metrics (response time, throughput, latency)
- ✅ **`/env`** — show environment context and diagnostics
- ✅ **`/alias`** — custom command shortcuts with persistent storage
- ✅ **`/multi`** — query multiple models in parallel for comparison
- ✅ **`/watch`** — file watcher configuration for auto-triggering commands

---

## v1.3 — Agent Runtime & Extensibility 🟡

Deep integration of the agentic features built in v1.2, plus a full
extension system and CI/CD scripting support.

**Runtime integrations (v1.2 features fully wired):**
- 🟡 **`--autopilot` CLI flag** — wire autopilot mode to CLI entry point with `runAutopilot(goal)` loop
- 🟡 **Safety net integration** — `checkCommandSafety()` called by shell tool before every execution
- 🟡 **`/pin` **`/unpin`**** — wire PinnedContext into sessions and slash commands
- 🟡 **Auto-compact** — automatic context compaction at 95% budget (configurable threshold)

**CI/CD & scripting:**
- 🟡 **`--json` flag** — structured JSON output for piping
- 🟡 **`--quiet` / `-q`** — suppress banners, spinners, decorative output
- 🟡 **`--yes` / `--no-confirm`** — auto-approve tool confirmations for automation

**Extension & skill system:**
- 🟡 **`/skill` command** — load, activate, and manage agent skills from files/URLs
- 🟡 **Extension loader** — `.icopilot/extensions/` with manifest.json discovery + hot-reload
- 🟡 **`/extension` command** — list, info, reload extensions

**Sub-agent architecture:**
- 🟡 **`/agent` command** — delegate to specialized agents (explore, task, review, plan)
- 🟡 **`/explore`** — codebase exploration with project context injection
- 🟡 **Background tasks** — `/task` management for long-running agent operations

**Session & memory enhancements:**
- 🟡 **Persistent project memory** — `/memory` command; facts survive across sessions
- 🟡 **`/share`** — session export/import bundles + clipboard format
- 🟡 **Enhanced `/context`** — full breakdown by source with trim suggestions

**Housekeeping:**
- 🟡 **Version bump** — 1.3.0 across package.json, CLI, interactive mode

---

## v1.4 — Multi-Agent Orchestration ✅

Parallel agent execution and coordination — matching Copilot CLI's
multi-agent capabilities.

**Parallel execution:**
- ⬜ **Parallel agent runner** — execute multiple sub-agents concurrently with merged output
- ⬜ **`&` suffix syntax** — background any prompt by appending `&` (e.g., `explain this code &`)
- ⬜ **Agent result aggregation** — combine outputs from parallel agents into a unified response
- ⬜ **Progress indicators** — live progress for concurrent agent tasks

**Agent specialization:**
- ⬜ **Custom agent definitions** — user-defined agents via `.icopilot/agents/*.yaml`
- ⬜ **Agent routing** — automatic delegation based on query classification
- ⬜ **Agent-to-agent handoff** — agents can delegate sub-tasks to other agents
- ⬜ **Agent memory isolation** — each agent maintains separate context window

**Tool enhancements:**
- ⬜ **`run_in_terminal` tool** — interactive terminal command execution with PTY
- ⬜ **`list_directory` tool** — structured directory listing for model consumption
- ⬜ **`search_symbols` tool** — AST-aware symbol search (treesitter integration)
- ⬜ **Tool retry logic** — automatic retry on transient tool failures

---

## v1.5 — Copilot Spaces & Team Features ✅

Project-scoped context management and collaborative features.

**Copilot Spaces:**
- ⬜ **Project spaces** — isolated context sandboxes per project/branch
- ⬜ **Space configuration** — `.icopilot/space.yaml` with default model, tools, skills, memory
- ⬜ **Space switching** — `/space <name>` to switch context workspace
- ⬜ **Space templates** — pre-configured spaces for common project types (node, python, rust, go)

**Collaboration:**
- ⬜ **Session handoff** — export session state for another developer to continue
- ⬜ **Shared memory** — team-wide `.icopilot/team-memory.md` with merge strategy
- ⬜ **PR-linked sessions** — auto-create session when checking out a PR branch
- ⬜ **Conversation threading** — branch conversations within a session

**Context intelligence:**
- ⬜ **Smart file selection** — model picks relevant files based on query (not just embeddings)
- ⬜ **Git-aware context** — auto-include recently modified files in context
- ⬜ **Dependency-aware context** — follow imports/requires to include related files
- ⬜ **Context priority scoring** — rank context sources by relevance to current query

---

## v1.6 — IDE-Grade Intelligence ✅

Deep language understanding and refactoring capabilities.

**Language intelligence:**
- ⬜ **Tree-sitter integration** — AST parsing for supported languages
- ⬜ **Symbol index** — project-wide symbol table (functions, classes, types, variables)
- ⬜ **Cross-file navigation** — go-to-definition, find-references via tools
- ⬜ **Type-aware refactoring** — rename symbol across all usages, extract interface

**Advanced code operations:**
- ⬜ **Multi-file atomic edits** — model proposes changes across N files, user reviews holistically
- ⬜ **Code generation with tests** — auto-generate test file when creating new module
- ⬜ **Migration assistant** — guided framework/language upgrades (e.g., CJS→ESM, React class→hooks)
- ⬜ **Dead code detection** — identify and optionally remove unused exports/functions

**Diagnostics:**
- ⬜ **Live error watching** — monitor build/test output and auto-suggest fixes
- ⬜ **Stack trace analysis** — paste error, get AI-powered root cause + fix
- ⬜ **Performance profiling** — analyze flamegraphs/traces with AI interpretation
- ⬜ **Dependency audit** — vulnerability scanning + upgrade path suggestions

---

## v1.7 — Workflow Automation ✅

Composable, repeatable workflows and CI/CD integration.

**Workflow engine:**
- ⬜ **Workflow definitions** — `.icopilot/workflows/*.yaml` declarative task chains
- ⬜ **Built-in workflows** — `review-and-commit`, `test-fix-loop`, `release-prep`
- ⬜ **Conditional steps** — if/then/else based on tool outputs
- ⬜ **Loop constructs** — repeat steps until condition met (e.g., "fix until tests pass")

**CI/CD integration:**
- ⬜ **GitHub Actions helper** — generate/edit workflow YAML from natural language
- ⬜ **Pipeline debugging** — analyze CI failure logs and suggest fixes
- ⬜ **Pre-commit hook** — optional git hook running `/review` + `/security` before commit
- ⬜ **Release automation** — version bump, changelog, tag, publish workflow

**Scheduling & triggers:**
- ⬜ **File watch triggers** — run workflow on file change
- ⬜ **Git hook integration** — pre-commit, post-merge, pre-push
- ⬜ **Cron-like scheduling** — periodic tasks (daily security scan, weekly dep updates)
- ⬜ **Webhook listener** — HTTP endpoint to trigger workflows externally

---

## v1.8 — Knowledge & Learning ✅

RAG, documentation generation, and adaptive learning.

**Knowledge base:**
- ⬜ **Project RAG** — chunk and index all project docs, README, wiki for retrieval
- ⬜ **External docs ingestion** — index API docs, framework guides, RFCs
- ⬜ **`/ask` with citations** — answers include source file + line references
- ⬜ **Knowledge refresh** — auto-reindex on git pull/checkout

**Documentation generation:**
- ⬜ **`/doc` command** — generate JSDoc/docstring for function/class/module
- ⬜ **README generation** — scaffold README from project structure + code analysis
- ⬜ **API doc generation** — extract public API surface → markdown reference
- ⬜ **Architecture diagrams** — generate mermaid diagrams from code relationships

**Adaptive behavior:**
- ⬜ **Style learning** — observe user's coding patterns and adapt suggestions
- ⬜ **Correction memory** — remember when user corrects the model; don't repeat mistakes
- ⬜ **Project conventions** — learn and enforce project-specific patterns (naming, structure)
- ⬜ **Confidence calibration** — model indicates certainty level; ask for confirmation on low-confidence actions

---

## v1.9 — Enterprise & Security ✅

Enterprise-grade features for teams and organizations.

**Access control:**
- ⬜ **Role-based tool access** — restrict tools by user role (admin/developer/viewer)
- ⬜ **Audit logging** — full audit trail of all tool executions and file changes
- ⬜ **Compliance modes** — HIPAA, SOC2, FedRAMP constraint profiles
- ⬜ **Secret scanning** — enhanced `/security` with real-time monitoring

**Enterprise integration:**
- ⬜ **SSO support** — SAML/OIDC authentication for enterprise tokens
- ⬜ **Proxy support** — HTTP/HTTPS/SOCKS5 proxy for corporate networks
- ⬜ **Air-gapped mode** — work with local models (Ollama, vLLM) when internet unavailable
- ⬜ **Usage quotas** — configurable token/request limits per user/project

**Data governance:**
- ⬜ **Content filtering** — prevent PII/secrets in prompts sent to API
- ⬜ **Data residency** — configure endpoint regions for compliance
- ⬜ **Retention policies** — auto-delete sessions/memory after N days
- ⬜ **Export controls** — restrict what can be shared/exported

---

## v2.0 — The Complete Agentic OS ✅

iCopilot becomes a full autonomous development environment — the terminal
equivalent of a senior engineering pair programmer.

**Autonomous development:**
- ⬜ **Goal-driven development** — describe a feature, iCopilot implements it end-to-end (plan → code → test → commit → PR)
- ⬜ **Self-healing builds** — detect build failures, diagnose, fix, and retry automatically
- ⬜ **Test-driven agent** — write tests first, then implement until green
- ⬜ **Multi-repo orchestration** — coordinate changes across multiple repositories

**Advanced reasoning:**
- ⬜ **Chain-of-thought planning** — visible reasoning with user intervention points
- ⬜ **Hypothesis testing** — model proposes theories, tests them with tools, converges on answer
- ⬜ **Long-term task tracking** — multi-session goals that persist across days/weeks
- ⬜ **Learning from outcomes** — track which approaches worked and prefer them in future

**Ecosystem:**
- ⬜ **Plugin marketplace** — `icopilot install <plugin>` from community registry
- ⬜ **Custom model providers** — plug in any OpenAI-compatible endpoint
- ⬜ **IDE bridge** — bidirectional communication with VS Code / Neovim
- ⬜ **API server mode** — expose iCopilot as HTTP API for integration

**Platform:**
- ⬜ **Multi-language REPL** — execute Python/JS/Rust snippets inline for validation
- ⬜ **Container sandbox** — Docker-based isolated execution environment
- ⬜ **Cloud sessions** — run sessions in the cloud, access from any terminal
- ⬜ **Mobile companion** — review/approve actions from phone via push notifications

---

## Non-goals

To keep iCopilot focused:

- ❌ No proprietary model backends — GitHub Models only (until v2.0 custom providers)
- ❌ No always-on background daemon (background tasks are session-scoped)
- ❌ No telemetry without explicit opt-in
- ❌ No GUI; terminal-first, always
- ❌ No vendor lock-in — sessions and config are portable plain files

---

## Contributing to the roadmap

Open an issue tagged `roadmap` with:

1. The problem you're trying to solve
2. Which phase/version it fits
3. Whether you'd like to own the implementation

Roadmap items are re-evaluated at the start of each minor version.
