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

- ⬜ `/undo` & `/redo` — file-write transaction journal (`src/session/undo-journal.ts`)
- ⬜ `/cost` — running token + USD cost estimator (`src/util/cost.ts`)
- ⬜ `web_fetch` tool — sandboxed HTTP GET with host allowlist (`src/tools/web.ts`)
- ⬜ `/snippets` — saved prompt templates (`src/snippets/*`)
- ⬜ `/profile` — named config profiles (`src/config-profile.ts`)
- ⬜ Shell completion script generator (`scripts/gen-completions.mjs`)
- ⬜ `/stats` — local usage counters (`src/stats/*`)
- ⬜ `/explain <path>` — quick file/folder summary
- ⬜ `/lint` — auto-detect & run project linters
- ⬜ `/bookmark` — bookmark/recall conversation positions (`src/session/bookmarks.ts`)
