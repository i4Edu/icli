# Sessions and memory

iCopilot stores conversations as JSON files under `~/.terminal-copilot/sessions` by default. Set `ICOPILOT_SESSION_DIR` to use a different directory.

## Resume a session

Use the session picker:

```text
/sessions
```

Pick a recent session to resume it in the current REPL.

## Export a session

Export a readable transcript:

```text
/export md
```

Export raw JSON state:

```text
/export json .\my-session.json
```

When no path is provided, iCopilot writes `session-<id>.md` or `session-<id>.json` in the current workspace.

## Auto-summary signal

Sessions track estimated token usage. `shouldAutoSummarize()` returns true when the conversation exceeds 85% of the configured context window, giving callers a rolling-summary trigger.
