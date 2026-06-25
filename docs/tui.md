# Experimental TUI mode

iCopilot includes a minimal opt-in full-screen TUI prototype:

```powershell
icopilot --tui
icopilot --tui --plan
```

The TUI uses only ANSI escape sequences and Node built-ins. It enters the terminal alternate screen, hides the cursor, and restores both on exit.

## Layout

- Row 1: status bar with iCopilot version, model, mode, and exit hint.
- Rows 2 through `rows - 3`: chat scrollback.
- Last three rows: divider, input prompt, and short help/status text.

## Controls

- Type a prompt and press Enter to send it.
- Use existing slash commands such as `/help`, `/model`, `/plan`, `/clear`, and `/exit`.
- Press Ctrl+C to leave the TUI immediately.

## When to use it

Use `--tui` when you want an isolated full-screen conversation surface that keeps the terminal clean. Use the default REPL when you prefer normal shell scrollback, copy/paste behavior, or the most stable interactive experience.

This is intentionally a prototype: rendering is simple, scrollback is in memory only, and the whole screen is redrawn as assistant output streams.
