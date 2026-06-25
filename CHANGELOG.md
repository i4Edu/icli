# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased] — v0.2 / v0.3 / v0.4 / v0.5 / v0.6 rollups

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

The following items from `roadmap.md` are deliberately not implemented in this
rollup and remain on the roadmap as exploration:

- TUI (ink), voice input, embeddings/indexing, multi-model routing, team mode
  over WebRTC, plugin marketplace.
- Full cold-start performance budget (worker-thread token counting, lazy markdown
  highlighting) — partial groundwork is in place.
