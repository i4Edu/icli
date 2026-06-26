# iCopilot — Roadmap

> Forward-looking roadmap for **iCopilot** (`icopilot` / `icli`), a terminal-native
> agentic CLI powered exclusively by the **GitHub Models API**.
>
> For the historical/implementation checklist see [`TODO.md`](./TODO.md).

## Legend

| Symbol | Meaning           |
| ------ | ----------------- |
| ✅     | Shipped           |
| 🟡     | In progress       |
| ⬜     | Planned           |
| 💡     | Idea / exploring  |

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

> The actual `npm publish` is a manual one-time setup step (NPM_TOKEN secret + first publish). The pipeline is end-to-end ready.

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

## v1.1 — Productivity & Reach ⬜

Ten focused enhancements that broaden the day-to-day surface area of
iCopilot without changing its core philosophy (terminal-first, GitHub
Models only, opt-in everything).

- ⬜ **`/undo` & `/redo`** — transaction journal of file writes (`src/session/undo-journal.ts`); restore previous bytes on demand
- ⬜ **`/cost`** — running token + estimated USD cost per session, with per-model rate table (`src/util/cost.ts`)
- ⬜ **`web_fetch` tool** — sandboxed HTTP GET tool with host allow/deny list (`src/tools/web.ts`)
- ⬜ **`/snippets`** — save / list / insert reusable prompt templates from `~/.icopilot/snippets/` (`src/snippets/*`)
- ⬜ **`/profile`** — named config profiles (model + theme + sandbox preset) (`src/config-profile.ts`)
- ⬜ **Shell completions** — generated bash / zsh / pwsh completion scripts (`scripts/gen-completions.mjs`)
- ⬜ **`/stats`** — local-only usage counters (tokens, tool calls, commands) persisted under `~/.icopilot/stats.json`
- ⬜ **`/explain <path>`** — quick one-shot file/folder summary using the cheap routed model
- ⬜ **`/lint`** — auto-detect project linters (`eslint`, `ruff`, `golangci-lint`…) and run them in the sandbox
- ⬜ **`/bookmark`** — bookmark a message in history; `/bookmark go <name>` rewinds context to that point

Each item is implemented as a self-contained module with its own
Vitest unit tests; integration is performed by editing the slash
dispatcher (`src/commands/slash.ts`) and the tool registry
(`src/tools/registry.ts`) once per feature.

---

## Non-goals

To keep iCopilot focused:

- ❌ No proprietary model backends — GitHub Models only
- ❌ No always-on background daemon
- ❌ No telemetry without explicit opt-in
- ❌ No GUI; terminal-first, always

---

## Contributing to the roadmap

Open an issue tagged `roadmap` with:

1. The problem you're trying to solve
2. Which phase/version it fits
3. Whether you'd like to own the implementation

Roadmap items are re-evaluated at the start of each minor version.
