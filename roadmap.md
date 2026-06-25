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

## v0.7 — Performance 🟡

- 🟡 Lazy-load heavy deps (`marked-terminal`, `gpt-tokenizer`) behind first use *(groundwork)*
- ⬜ Token counting in a worker thread for large `@file` injections
- ⬜ Streamed markdown renderer with incremental code-block highlighting
- ⬜ Cold-start budget: `< 150 ms` to first prompt on Node 20

---

## v1.0 — Stable Release ⬜

Criteria to ship 1.0:

- ⬜ All v0.2–v0.4 items complete
- ⬜ Public API for tools, slash commands, and MCP frozen and documented
- ⬜ End-to-end smoke tests on Linux / macOS / Windows
- ⬜ `npm publish` under stable tag, signed release artifacts
- ⬜ Documentation site (README + `/docs`) with recipes
- ⬜ Semantic-versioning + CHANGELOG.md automation

---

## Beyond 1.0 — Exploration 💡

- 💡 **TUI mode** — full-screen ink-based UI with panes (chat / diff / files)
- 💡 **Voice input** — push-to-talk via local STT
- 💡 **Workspace indexing** — embeddings cache for repo-wide retrieval
- 💡 **Multi-model routing** — cheap model for planning, strong model for edits
- 💡 **Team mode** — shared session over WebRTC for pair-programming
- 💡 **Plugin marketplace** — discover & install MCP servers from CLI

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
