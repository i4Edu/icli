# iCopilot — Recipes

Practical snippets for common workflows.

## 1. Pipe stdin into a one-shot prompt

```bash
git diff | icopilot -p "Summarize this diff in three bullet points."
```

## 2. Add a project memory file

```bash
mkdir -p .icopilot
cat > .icopilot/memory.md <<'EOF'
- This is a Vite + React 18 + TypeScript project.
- Tests live in `tests/`; we use Vitest.
- Never edit files under `generated/`.
EOF
```

iCopilot prepends this to the system prompt on every turn.

## 3. Lock the model per project (rc file)

```jsonc
// ~/.icopilotrc.json
{
  "defaultModel": "gpt-4o",
  "theme": "dark",
  "logLevel": "info"
}
```

Env vars and CLI flags still override the rc file.

## 4. Run sandboxed in CI

```bash
icopilot --sandbox --no-color -p "Fix lint errors in @src/index.ts"
```

`--sandbox` restricts shell and write tools to the working directory.

## 5. Deny `rm -rf` via policy

```jsonc
// .icopilot/policy.json
{
  "denyShell": ["rm -rf*", "git push --force*"],
  "allowWrite": ["src/**", "tests/**", "docs/**"]
}
```

## 6. Export a session to Markdown for a PR description

```text
> /export md ./pr-context.md
✔ exported /abs/path/pr-context.md
```

## 7. Connect a Filesystem MCP server

```jsonc
// .mcp.json
{
  "servers": {
    "filesystem": {
      "command": "npx",
      "args": ["-y", "@modelcontextprotocol/server-filesystem", "."]
    }
  }
}
```

Tools appear as `mcp__filesystem__read_file`, `mcp__filesystem__write_file`,
etc.

## 8. Draft a refactor in plan mode first

```text
> /plan
✔ mode → plan
> Refactor @src/api/github-models.ts to add response caching.
(model produces a numbered plan)
> go
(model executes the plan with tool calls)
```

## 9. Resume a previous session

```text
> /sessions
? Pick a session:
  ▸ 2026-06-24 17:32  gpt-4o  18 msgs  refactor cache
    2026-06-23 09:14  gpt-4o-mini  6 msgs  hello world
✔ resumed session 7f2b...
```

## 10. Generate a Conventional Commit

```bash
git add -p
icopilot
> /commit
```

## 11. Draft a GitHub issue and create it with `gh`

```text
> /issue Adding multi-window TUI
(model writes title + body)
? Create issue with `gh`?  (Y/n)
```

## 12. Restrict writes to a subdirectory

```jsonc
// .icopilot/policy.json
{
  "allowWrite": ["packages/web/**"],
  "denyWrite": ["**/.env*", "**/secrets/**"]
}
```

## 13. Build and search the workspace index

```text
> /index build
✔ indexed 421 files, 2,103 chunks in 8,742ms

> /index search streaming tokens
src/api/github-models.ts chunk 1 (score 0.873)
  …content snippet…
```

## 14. Switch routing profile per task class

```text
> /route set balanced
✔ routing profile → balanced
# now cheap models plan, strong models edit/review
```
