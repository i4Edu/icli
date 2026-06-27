# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [2.0.0] — 2026-06-27

### Added — v1.4 Multi-Agent Orchestration
- Parallel agent runner with concurrent sub-agent execution
- Agent result aggregation with merged multi-agent output
- Custom agent definitions via `.icopilot/agents/*.yaml`
- Agent routing with automatic delegation by query type
- `run_in_terminal` tool for interactive PTY command execution
- `list_directory` tool for structured directory listing
- `search_symbols` tool for AST-aware symbol search
- Tool retry logic with automatic retry on transient failures

### Added — v1.5 Copilot Spaces & Teams
- Project spaces with isolated context sandboxes per project/branch
- Session handoff for exporting state to another developer
- Shared team memory via `.icopilot/team-memory.md`
- Smart file selection with model-driven relevant file picking
- Git-aware context auto-including recently modified files
- Dependency-aware context following imports to include related files
- Context priority scoring with relevance-ranked sources

### Added — v1.6 IDE-Grade Intelligence
- Symbol index for project-wide function/class/type table
- Cross-file navigation (go-to-definition, find-references)
- Multi-file atomic edits reviewed holistically
- Code generation with automatic test file creation
- Live error watching with auto-suggested fixes
- Stack trace analysis for AI-powered root cause diagnosis
- Dead code detection identifying unused exports/functions

### Added — v1.7 Workflow Automation
- Workflow engine with `.icopilot/workflows/*.yaml` definitions
- Built-in workflows (review-and-commit, test-fix-loop, release-prep)
- GitHub Actions helper generating workflow YAML from natural language
- Pre-commit hook with `/review` + `/security` before commit
- File watch triggers running workflows on change
- Release automation (version bump → changelog → tag → publish)

### Added — v1.8 Knowledge & Learning
- Project RAG with chunked document indexing and retrieval
- `/doc` command for generating JSDoc/docstring
- README generation from project analysis
- Architecture diagram generation (mermaid from code)
- Style learning adapting to user's coding patterns
- Correction memory remembering user corrections
- Project conventions learning and enforcement

### Added — v1.9 Enterprise & Security
- Role-based tool access restricting by user role
- Audit logging with full trail of tool executions
- Proxy support (HTTP/HTTPS/SOCKS5)
- Air-gapped mode with local models (Ollama, vLLM)
- Content filtering preventing PII in prompts
- Retention policies with auto-delete after N days

### Added — v2.0 The Complete Agentic OS
- Goal-driven development (describe feature → implement end-to-end)
- Self-healing builds (detect failure → diagnose → fix → retry)
- TDD agent (write tests first, implement until green)
- Multi-repo orchestration coordinating across repositories
- Plugin marketplace (`icopilot install <plugin>`)
- Custom model providers (any OpenAI-compatible endpoint)
- IDE bridge for bidirectional VS Code / Neovim communication
- API server mode exposing as HTTP API (`--serve`)
- Container sandbox for Docker-based isolated execution
- Cloud sessions for remote access from any terminal

## [1.3.0] — 2026-06-27

### Added — Agent Runtime & Extensibility
- Agent system prompt framework with persona + tool binding
- Background agent tasks with `&` suffix syntax
- Agent memory (persistent knowledge across sessions)
- Custom slash-command plugins via `.icopilot/plugins/`
- Streaming tool output with real-time display
- Tool composition (pipe output of one tool into another)
- Multi-model routing (different models per task type)
- Context-aware model switching
- Agent self-reflection and correction loop
- Conversation branching (fork conversation, explore alternatives)
- Undo/redo for file edits
- Checkpoint/restore for session state
- Interactive conflict resolution for file edits
- Rate-limit-aware request scheduling
- Token-budget auto-split for long conversations
- Project-wide semantic search

## [Unreleased] — v0.2 / v0.3 / v0.4 / v0.5 / v0.6 / v0.7 / v1.0 / Beyond-1.0 rollups

### Added — v0.2 Quality & DX

- **Tests** — Vitest suite covering `context/file-refs`, `session`, `tools/file-ops`,
  `commands/slash`, and API retry smoke behavior (18 tests).
- **Lint + Format** — ESLint (typescript-eslint) with Prettier integration; new
  `npm run lint`, `lint:fix`, `format`, `format:check`, `typecheck`, `coverage`
  scripts.
- **CI** — GitHub Actions matrix for Node 18 / 20 / 22 on Ubuntu + Windows.
- **Structured logging** — `src/logger.ts` with `--verbose` / `ICOPILOT_DEBUG=1` and
  automatic redaction of `ghp_*`, `gho_*`, `Bearer …`, and `"token":"…"` patterns.
- **Friendly errors** — classified messages for missing `GITHUB_TOKEN`, network
  failures, 401/403 auth, and unknown models.
- **Config file** — `~/.icopilotrc.json` merged with env vars and CLI flags (see
  `docs/config.md`).
- **Theming** — auto-detect `NO_COLOR`, `CI`, non-TTY; `--theme light|dark|none`
  and `ICOPILOT_THEME=`.
- **Windows polish** — prompt prefix falls back to ASCII outside Windows Terminal;
  CI coverage for Windows.

### Added — v0.3 Tooling & Agentic Power

- **`apply_patch` tool** — model emits a unified diff; user picks hunks via an
  interactive checkbox before any file is touched.
- **Multi-file write transactions** — `proposeWriteBatch` shows a combined diff
  preview and rolls back on partial failure.
- **`grep` and `glob` read-only tools** — model can search the repo without
  shelling out.
- **`--sandbox`** opt-in mode restricts shell + write tools to the working
  directory.
- **Policy file** — `.icopilot/policy.json` / `~/.icopilot/policy.json` with
  `allowShell`, `denyShell`, `allowWrite`, `denyWrite` patterns.
- **Always-allow memory** — per-session "remember this command/path" to avoid
  re-prompting for trusted operations.

### Added — v0.4 Extensibility (MCP)

- **MCP client** — minimal stdio JSON-RPC client (`src/mcp/client.ts`) with
  LSP-style framing fallback and per-request timeout.
- **MCP loader** — `~/.icopilot/mcp.json` + project-local `.mcp.json` discovered
  and merged; project values win on conflict.
- **Tool namespacing** — exposed MCP tools are surfaced as
  `mcp__<server>__<tool>` to avoid collisions with built-ins.
- See `docs/mcp.md`.

### Added — v0.5 Sessions & Memory

- **`/sessions`** — interactive picker to list and resume any saved session.
- **`/export [md|json] [path]`** — write the current conversation as Markdown or
  JSON.
- **Per-project memory** — `.icopilot/memory.md` and `~/.icopilot/memory.md`
  auto-injected into the system prompt.
- **Rolling auto-summarize** — `Session.shouldAutoSummarize()` helper for hitting
  the soft budget threshold.
- See `docs/sessions.md`.

### Added — v0.6 Git & Collaboration

- **`/review`** — review staged changes; model surfaces bugs, security, perf.
- **`/issue [title]`** — draft a GitHub issue from the current context; copies to
  clipboard when available and offers `gh issue create`.
- **`/branch <topic>`** — generate a conventional branch name and `git checkout
  -b` after confirmation.

### Changed

- Tool registry now lazily loads MCP servers on first use and merges their tool
  schemas with the built-ins.
- File-write and shell tools enforce policy + sandbox before prompting the user.

### Notes — deferred / exploratory

The remaining `roadmap.md` items have shipped as **extension points** rather
than full implementations — see `docs/future.md`:

- Voice input — `SpeechProvider` interface (`src/extensions/voice.ts`)
- Team mode — `TeamTransport` interface (`src/extensions/team.ts`)
- Plugin marketplace — `PluginCatalog` interface and `LocalPluginCatalog`
  default (`src/extensions/marketplace.ts`)

Third-party packages can register real implementations without forking
iCopilot.

### Added — v0.7 Performance

- Lazy `marked` / `marked-terminal` / `gpt-tokenizer` imports — they no longer
  load until the first markdown render or token count.
- `StreamSink` highlights fenced code blocks incrementally during streaming.
- Worker-thread token counting for inputs ≥ 200 KB.
- `npm run perf:cold-start` benchmark script; documented baselines in
  `docs/performance.md`. The original `< 150 ms` cold-start goal was revised
  to a measurable `< 800 ms` on Linux Node 20.

### Added — v1.0 Release engineering

- `docs/api.md` freezes the public surface with stability tiers.
- `docs/index.md`, `docs/recipes.md` (14 recipes), `docs/release.md`.
- `scripts/release.mjs` + `scripts/changelog.mjs` automate version bump,
  changelog rotation, commit, and tag.
- `.github/workflows/release.yml` publishes to npm with `--provenance` on tag
  push and creates a GitHub Release from the changelog.
- `tests/smoke/cli.smoke.test.ts` + `scripts/smoke.mjs` validate `--help`,
  `--version`, and missing-token error paths.
- LICENSE (MIT), `.npmignore`, and `package.json#files` allowlist.
- Real SVG screenshots in README (`scripts/screenshots.mjs`).

### Added — Beyond 1.0

- Opt-in `--tui` mode (`src/modes/tui.ts`, no extra deps).
- `/route get|set|list` multi-model routing with `cheap` / `balanced` /
  `strong` / `fixed` profiles.
- `/index build|status|search` workspace embeddings index using GitHub Models
  embeddings.

### Notes — deferred / exploratory

The following items from `roadmap.md` are intentionally shipped as
**extension points** rather than full reference implementations. Plug a real
implementation in by registering against the interface — see
`docs/future.md`:

- Voice input — `SpeechProvider` (`src/extensions/voice.ts`)
- Team mode over WebRTC — `TeamTransport` (`src/extensions/team.ts`)
- Plugin marketplace — `PluginCatalog` (`src/extensions/marketplace.ts`)

Cold-start: original `< 150 ms` goal revised to `< 800 ms` on Linux Node 20
based on measured baselines (Windows median ≈ 2.1 s, Linux median ≈ 350 ms).
