# GitHub Copilot CLI — Comprehensive TUI Reference

> **Scope:** This document covers the **official GitHub Copilot CLI** (`copilot` / `@github/copilot`) —
> the terminal interface you get when you run `copilot` in your shell. This is the product
> described at https://docs.github.com/copilot/concepts/agents/about-copilot-cli, **not** the
> local `icopilot` / `icli` project in this repository.

---

## Table of Contents

1. [Installation & Entry Points](#1-installation--entry-points)
2. [Launch Sequence & First-Run Flow](#2-launch-sequence--first-run-flow)
3. [Animated Splash Banner](#3-animated-splash-banner)
4. [Overall TUI Layout Architecture](#4-overall-tui-layout-architecture)
5. [Tab Bar (June 2026 GA Redesign)](#5-tab-bar-june-2026-ga-redesign)
6. [Timeline / Conversation Area](#6-timeline--conversation-area)
7. [Input Composer Box](#7-input-composer-box)
8. [Footer / Status Bar](#8-footer--status-bar)
9. [Modes — Ask · Plan · Autopilot](#9-modes--ask--plan--autopilot)
10. [Colors, Themes & Accessibility](#10-colors-themes--accessibility)
11. [Spacing, Padding & Responsive Design](#11-spacing-padding--responsive-design)
12. [Streaming Responses & Thinking Display](#12-streaming-responses--thinking-display)
13. [Tool Call Approval Flow](#13-tool-call-approval-flow)
14. [Inline Input Features](#14-inline-input-features)
15. [Slash Commands — Full Reference](#15-slash-commands--full-reference)
16. [Global Keyboard Shortcuts](#16-global-keyboard-shortcuts)
17. [Timeline Shortcuts](#17-timeline-shortcuts)
18. [Navigation (Cursor/Editing) Shortcuts](#18-navigation-cursorediting-shortcuts)
19. [Diff Mode Shortcuts](#19-diff-mode-shortcuts)
20. [Session Picker Shortcuts](#20-session-picker-shortcuts)
21. [Special Inline Prefixes](#21-special-inline-prefixes)
22. [Context Management](#22-context-management)
23. [MCP Server Integration](#23-mcp-server-integration)
24. [Custom Agents & Skills](#24-custom-agents--skills)
25. [File & Image Attachments](#25-file--image-attachments)
26. [Background Tasks & Fleet Mode](#26-background-tasks--fleet-mode)
27. [Session Management](#27-session-management)
28. [LSP (Language Server Protocol) Integration](#28-lsp-language-server-protocol-integration)
29. [Security & Permission Model](#29-security--permission-model)
30. [Environment Variables & Config Files](#30-environment-variables--config-files)
31. [Programmatic / Non-Interactive Mode](#31-programmatic--non-interactive-mode)
32. [Platform-Specific Behaviour](#32-platform-specific-behaviour)
33. [Summary Cheat-Sheet](#33-summary-cheat-sheet)

---

## 1. Installation & Entry Points

| Method | Command |
|--------|---------|
| **npm** (all platforms, Node 22+) | `npm install -g @github/copilot` |
| **Homebrew** (macOS/Linux) | `brew install --cask copilot-cli` |
| **WinGet** (Windows) | `winget install GitHub.Copilot` |
| **Install script** (macOS/Linux) | `curl -fsSL https://gh.io/copilot-install \| bash` |
| **Prerelease (npm)** | `npm install -g @github/copilot@prerelease` |
| **Direct binary** | Download from `github.com/github/copilot-cli/releases` |

After installation, two binaries are available: **`copilot`** (primary) and shell-completion
helpers (`copilot completion bash|zsh|fish`).

Config and sessions are stored under `~/.copilot/` by default.  Set `COPILOT_HOME` to override.

---

## 2. Launch Sequence & First-Run Flow

```
$ copilot
```

The CLI goes through the following stages in order:

```
┌─────────────────────────────────────────────────┐
│  1. Animated splash banner (first launch only)  │
│     --banner flag re-shows it any time          │
├─────────────────────────────────────────────────┤
│  2. Trust dialog                                │
│     "Do you trust files in this folder?"        │
│     1. Yes, proceed (this session)              │
│     2. Yes, and remember this folder            │
│     3. No, exit (Esc)                           │
├─────────────────────────────────────────────────┤
│  3. Auth check                                  │
│     If no token found → prompt to run /login   │
│     OAuth browser flow or PAT via env var       │
├─────────────────────────────────────────────────┤
│  4. Main interactive TUI rendered               │
│     Tab bar, conversation area, input box,      │
│     footer — all drawn to the terminal          │
└─────────────────────────────────────────────────┘
```

**Flags accepted at launch:**

| Flag | Effect |
|------|--------|
| `--banner` | Force-show the animated splash banner |
| `--experimental` | Enable experimental features (persisted to config) |
| `--allow-all` / `--yolo` | Auto-approve all tool calls without prompting |
| `--allow-tool='shell(git)'` | Pre-approve a specific tool |
| `--resume` / `--continue` | Resume the most recently closed session |
| `-p / --prompt TEXT` | One-shot non-interactive mode |
| `--agent=NAME` | Delegate to a named custom agent |
| `--cloud` | Start session inside a cloud sandbox |

---

## 3. Animated Splash Banner

On first launch (and with `--banner`), a full-screen animated banner fills the terminal. It
features:

- **GitHub Copilot CLI** branding with animated colour cycling.
- Welcome text and quick-start tips.
- A visible instruction to run `/login` if unauthenticated.

After the animation, the banner dissolves into the main TUI layout.

---

## 4. Overall TUI Layout Architecture

The terminal is divided into four vertical zones, drawn from top to bottom:

```
╔══════════════════════════════════════════════════════════╗   ← Row 0
║  TAB BAR:  [Session]   Issues   Pull requests   Gists   ║
╠══════════════════════════════════════════════════════════╣   ← Rows 1 … N-3
║                                                          ║
║            TIMELINE / CONVERSATION AREA                  ║
║  (scrollable; grows upward as messages are added)        ║
║                                                          ║
╠══════════════════════════════════════════════════════════╣   ← Row N-2
║  INPUT COMPOSER                                          ║
║  ❯ ▊                                                     ║
╠══════════════════════════════════════════════════════════╣   ← Row N-1
║  STATUS / FOOTER:  cwd  ·  branch  ·  model  ·  tokens  ║
╚══════════════════════════════════════════════════════════╝   ← Row N (bottom)
```

**Zone heights** adapt dynamically to terminal height.  The Timeline consumes all rows not
taken by the other three fixed-height zones.

---

## 5. Tab Bar (June 2026 GA Redesign)

The tab bar at **row 0** spans the full terminal width.  It is rendered with a deep-blue
background track (`\x1b[44m`) and bright/dim text to distinguish active from inactive tabs.

```
[Session]   Issues   Pull requests   Gists
```

- **Active tab** is wrapped in `[…]` brackets with bold/white text.
- **Inactive tabs** are dimmed.
- Gaps between tabs: 3 spaces (`   `).
- On narrow terminals the tab bar clips gracefully — still blue track, plain text.

**Tab content:**

| Tab | Available when | Contents |
|-----|----------------|----------|
| **Session** | Always | Main conversation & input |
| **Issues** | Inside a GitHub repo | Interactive issue browser for that repo |
| **Pull requests** | Inside a GitHub repo | Interactive PR browser for that repo |
| **Gists** | Always | Personal gists browser |

**Tab interactions:**

| Key | Action |
|-----|--------|
| `Tab` | Move to next tab |
| Mouse click | Switch to clicked tab |
| `c` (on issue/PR row) | Drop `#NUMBER` reference into prompt |
| `o` (on issue/PR row) | Open item on GitHub.com in browser |
| `/` (on Issues/PR tab) | Open GitHub search for that tab |

Tabs can be **reordered, hidden, or turned off entirely** via `/settings`.

---

## 6. Timeline / Conversation Area

The timeline is a scrollable panel that grows as the conversation progresses.

### Message anatomy

Each turn in the conversation is rendered as a **timeline item**:

```
──────────────────────────────────────────────────────
You                                        [timestamp]
──────────────────────────────────────────────────────
  Your prompt text here, possibly multiple lines.

──────────────────────────────────────────────────────
● Copilot                                  [timestamp]
──────────────────────────────────────────────────────
  Thinking…  (spinner while processing)

  Response text streamed token-by-token.

  ┌─ shell ──────────────────────────────────────────┐
  │  git commit -m "feat: add login page"            │
  └──────────────────────────────────────────────────┘

  [Tool call: shell(git commit …)]  ✔ approved
```

### Timeline element hierarchy

```
Timeline
├── User message block
│   ├── Separator line (full-width ─── in muted colour)
│   ├── Speaker label: "You" (bold, brand-blue)
│   └── Prompt content (plain text, padded 2 columns)
│
├── Assistant message block
│   ├── Separator line
│   ├── Speaker label: "● Copilot" (● in purple/accent, bold)
│   ├── [Live stream] Spinner + streamed text (updates per token)
│   ├── [Reasoning block] Collapsed by default; Ctrl+T to expand
│   ├── Content (markdown-rendered: code blocks, bold, lists…)
│   ├── Tool call chip(s) with status icon
│   └── [Followup chips] "Next: [action1]  [action2]"
│
├── Tool-approval prompt (interactive)
│   ├── Tool name + command summary
│   ├── Numbered choices: 1. Yes  2. Yes, approve for session  3. No (Esc)
│   └── Inline feedback field (after rejection)
│
└── System/notification message
    └── (warn/error badge + text, auto-dismissed)
```

### Separator lines

Full-width `─` characters in **`#30363D`** (dark separator colour) drawn at terminal column
width. Every message block is preceded by one separator.

### Speaker labels

| Role | Label | Colour |
|------|-------|--------|
| User | `You` | Bold `#58A6FF` (brand blue) |
| Copilot | `● Copilot` | `●` in `#A371F7` (purple/accent), rest bold |
| Error | `✖ Error` | Bold `#F85149` (red) |
| Info | `ℹ  Info` | `#8B949E` (muted grey) |
| System | `⏱ System` | `#8B949E` (muted grey) |

---

## 7. Input Composer Box

The input area sits at the bottom of the screen, directly above the footer.

### Visual structure

```
▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄   ← accent-colour upper separator (▄)
❯ your input here▊                               ← prompt glyph + text + block cursor
▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀   ← separator-colour lower separator (▀)
~/projects/myrepo   main  gpt-4o-mini  ~12k ctx  ← footer bar
```

- **Upper separator:** `▄` repeated at full terminal width, in `colors.accent` (`#A371F7`).
- **Lower separator:** `▀` repeated at full terminal width, in `colors.separator` (`#30363D`).
- **Prompt glyph:** `❯` — bold green (`#3FB950`) when idle; orange `◆` when busy.
- **Block cursor:** inverse-coloured space character `▊` drawn after the current input.
- **Padding:** 1 column left (`paddingX={1}` in the Ink layout).

### Multi-line input

`Shift+Enter` (or `Option+Enter` on Mac, `Alt+Enter` on Windows/Linux) inserts a newline
inside the input for multi-line prompts.

`/terminal-setup` configures the terminal to enable Shift+Enter if it does not work
out-of-the-box.

### Ghost text / inline hint

When the input field is empty, **ghost text** is shown in dim italic:

```
❯ Enter @ to mention files or / for commands…▊
```

Ghost text disappears immediately on the first keypress.  After typing `@`, a path completion
hint appears.  After typing `/`, the matched slash command name is shown as ghost text.

### Slash autocomplete dropdown

Typing `/` followed by any characters triggers an inline autocomplete dropdown **below** the
input row:

```
❯ /mod▊
  /model          ← highlighted (bold green)
  /mcp
  /mcp add
```

- Up to **8 suggestions** shown at a time.
- `↑`/`↓` cycle the highlighted entry.
- `Tab` or `Enter` accepts the highlighted entry (completing with a trailing space).
- The dropdown disappears when input diverges from all commands.

### Followup chips

After Copilot finishes a response, up to **4 followup action chips** are shown above the upper
separator:

```
Next:  [diagnose network]  [optimize config]  [write tests]
       ↵ run   Ctrl+N/P cycle   Esc dismiss
```

- Active chip is bold green `[chip]`; others are muted grey.
- `↵ Enter` on empty input submits the active chip as a prompt.
- `Ctrl+N` / `Ctrl+P` cycle chips forward / backward.
- `Esc` clears all chips.

### Busy state

While Copilot is working, the prompt glyph changes to `◆` (orange/warning colour) and
` (working…)` in dim text is appended.  Keyboard input is queued during this state.

---

## 8. Footer / Status Bar

The footer (last row) is a single-line status bar with **left-aligned** and **right-aligned**
sections, gap-filled with spaces to reach full terminal width:

```
~/projects/myrepo   main                       gpt-4o-mini  ·  ~12k ctx
└── cwd ──────────── └── git branch ───────    └── model ──────── └── token count
```

- **cwd:** Current working directory with `~` home shortening.
- **Branch:** Nerd Font powerline glyph `\uE0A0` + branch name (if git repo detected).
- **Model name:** Currently active model, right-aligned.
- **Token count:** Shown as `~Nk ctx` once context has been used, right-aligned.
- **Colour:** All text in `colors.muted` (`#8B949E`).

---

## 9. Modes — Ask · Plan · Autopilot

Press **`Shift+Tab`** to cycle through the three modes:

```
  interactive (ask) → plan mode → autopilot mode → (back to interactive)
```

### Ask / Execute Mode (default)

Standard conversational mode.  You send a prompt; Copilot responds, may call tools (with your
approval), and waits for the next prompt.

### Plan Mode

Activated by `Shift+Tab` once, or via the `/plan` slash command.

- Copilot analyses your prompt and asks **clarifying questions** before any code is written.
- Builds a **structured numbered implementation plan** displayed in the timeline.
- You review and refine the plan interactively.
- After approval, you can execute or switch to autopilot.

The mode indicator is shown in the input prefix and footer.

### Autopilot Mode (Experimental)

Activated by `Shift+Tab` twice, or via `/experimental on` + then Shift+Tab.

- Copilot **continues working autonomously** until:
  - It judges the task complete.
  - A hard failure is encountered.
  - You press `Esc` or `Ctrl+C`.
  - A preset step limit is reached.
- All tool calls are auto-approved (per pre-configured permissions).
- Best for well-scoped, end-to-end tasks.

You can also accept a plan in Plan mode and choose **"Accept plan and build on autopilot"** to
hand execution off without further interaction.

---

## 10. Colors, Themes & Accessibility

### Default colour palette (dark terminal)

| Token | Hex | Role |
|-------|-----|------|
| `accent` | `#A371F7` | Purple — tab bar separators, `●` Copilot bullet, timeline separators |
| `brand` | `#58A6FF` | Blue — "iCopilot CLI" title, "You" label, links |
| `success` | `#3FB950` | Green — `❯` prompt glyph, active followup chip |
| `warning` | `#D29922` | Amber — `◆` busy glyph, warnings |
| `error` | `#F85149` | Red — error messages, `✖` label |
| `muted` | `#8B949E` | Grey — metadata, footer, dim text, separators |
| `separator` | `#30363D` | Dark — turn dividers, lower input separator |
| `user` | `#58A6FF` | Blue — "You" speaker label |
| `copilot` | `#A371F7` | Purple — "● Copilot" speaker label |
| `slash` | `#E3B341` | Gold — slash command highlight |

### Theme command

Run **`/theme`** inside an interactive session to view and set the colour mode:

| Mode | Description |
|------|-------------|
| `default` | Auto-detected dark or light theme |
| `dim` | Reduced brightness, lower contrast |
| `high-contrast` | Maximum contrast for readability |
| `colorblind` | Adjusted palette for colour-vision differences |

Light-terminal overrides use darker shades of the same hues (e.g. brand blue becomes
`#0F6CBD`).

### Accessibility

- **Screen reader support** auto-enables when a screen reader is detected.
- Icons and spinner animations **disable themselves** automatically with a screen reader.
- All icons are **labelled** for AT consumption.
- Colours never carry meaning alone — shapes (`●`, `✖`, `✔`, `◆`) and text labels are always present alongside colour.

### Colour detection logic

```
if FORCE_COLOR env var is set     → colours on
if NO_COLOR env var is set        → colours off
if stdout is not a TTY            → colours off  (piped output = no colour)
if running in CI                  → colours off
if chalk.level > 0                → colours on
else                              → colours off (plain text fallback)
```

---

## 11. Spacing, Padding & Responsive Design

### Terminal size detection

The TUI reads `process.stdout.columns` and `process.stdout.rows` on every render.  Fallbacks:

```
columns → 80   (if stdout.columns is 0 / undefined)
rows    → 24   (if stdout.rows is 0 / undefined)
```

### Resize handling

The CLI listens for **`SIGWINCH`** (Unix) and **`stdout 'resize'`** (Windows ConPTY) events.
On resize, the entire layout reflowing: tab bar re-clips, content re-wraps, footer re-gaps.

### Width-adaptive rules

| Element | Rule |
|---------|------|
| Tab bar | Active tab in `[…]`, clips tab labels if total > cols |
| Input box | Fills 100% of terminal width (`width="100%"`) |
| Separator lines | `─` / `▄` / `▀` repeated exactly `cols` times |
| Message content | `paddingX={1}` (1 col left+right), wraps at `cols - 2` |
| Status dock (footer) | Left + right sections with computed gap to fill width exactly |
| Response box | Max 100 columns, capped via `Math.min(cols, 100)` |
| Context panel (if open) | `padVisible()` clips text to exact panel width |
| Path in footer | Progressive shortening: `~/…/sub/path` until it fits |

### Minimum usable width

The input box has a hard minimum of **60 columns** (`Math.max(60, cols - 6)`). Below 60 the
layout degrades gracefully but may overlap.  The tab bar begins clipping tab labels around
**50 columns**.

### Height-adaptive rules

- The **timeline** grows to fill all rows not taken by tab bar (1 row), input area (~3 rows),
  and footer (1 row).
- If the terminal is shorter than ~8 rows, some zones may overlap.
- The scroll region is maintained via ANSI scroll-region escape (`\x1b[1;${rows-2}r`) so the
  footer stays docked at the bottom.

---

## 12. Streaming Responses & Thinking Display

### Token streaming

As Copilot generates a response, tokens are **streamed in real time** into the live panel above
the input box. Each chunk is appended to the live buffer and re-rendered.  The spinner
(`⠋⠙⠹⠸⠼⠴⠦⠧⠇⠏`, 80 ms per frame) runs alongside the text until generation completes.

Once the full response arrives, it is moved from the live buffer to the **frozen Static history**
where it renders with full markdown formatting (code blocks, bold, lists, etc.).

### Code fences during streaming

While streaming, the CLI tracks fenced `` ``` `` code blocks across token boundaries.
Inside a fence:
- **Shell/bash** (`sh`, `bash`, `zsh`, `fish`) → syntax-highlighted with shell colouriser.
- **Other languages** → rendered in `theme.hl` (link-blue highlight).
- Fence delimiters → `theme.dim` (grey).

Once streaming is done, the complete buffer is re-rendered as styled markdown.

### Reasoning / Thinking display

Some models support **extended thinking** (chain-of-thought reasoning) before answering.

- By default, reasoning blocks are **collapsed** in the timeline.
- Press **`Ctrl+T`** to toggle the expand/collapse state for all reasoning blocks.
- A collapsed reasoning block shows as a single dimmed line: `▶ Thinking (N tokens)…`
- An expanded reasoning block shows the full chain-of-thought text indented below.

---

## 13. Tool Call Approval Flow

When Copilot needs to execute a tool (shell command, file write, HTTP request, etc.), it
**pauses and renders an approval prompt** in the timeline:

```
──────────────────────────────────────────────────
⚙ Tool request
──────────────────────────────────────────────────
  shell: git commit -m "feat: add user auth"

  1. Yes
  2. Yes, and approve shell for the rest of the session
  3. No, and tell Copilot what to do differently (Esc)

  ❯ _
```

### Approval options

| Choice | Effect |
|--------|--------|
| **1 Yes** | Allow this single invocation; ask again next time |
| **2 Yes, approve for session** | Allow this tool (any args) without prompting for the rest of this session run |
| **3 No (Esc)** | Cancel; an inline feedback field appears so you can steer Copilot's next attempt |

### Pre-approval flags

| Flag | Scope |
|------|-------|
| `--allow-all` / `--yolo` | Approve every tool call automatically |
| `--allow-tool='shell(git)'` | Pre-approve one tool |
| `/allow-all` slash command | Toggle allow-all inside an active session |
| `/reset-allowed-tools` | Clear all in-session tool approvals |
| `/permissions show` | List currently granted permissions |

### Inline rejection feedback

When you reject (option 3), instead of restarting, Copilot displays an **inline text field**:
```
  Tell Copilot what to do differently: ❯ _
```
You type your guidance and Copilot adapts its approach without ending the turn.

---

## 14. Inline Input Features

### `@` file mention

Typing `@` triggers file/directory autocomplete:

```
❯ Explain @src/auth▊
           ┌─────────────────────┐
           │ src/auth.ts         │  ← highlighted
           │ src/auth/index.ts   │
           │ src/auth/helper.ts  │
           └─────────────────────┘
```

- Matches update as you type with **fuzzy matching**.
- `↑` / `↓` navigate suggestions.
- `Tab` completes the selected path.
- Multiple `@` mentions are supported in a single prompt.
- Images and PDFs can also be referenced with `@`.

### `#` GitHub reference

Typing `#` followed by a number includes a GitHub issue or PR in the context:

```
❯ Fix #1234▊
```

### `!` Shell bypass

Typing `!` before a command runs it directly in your local shell, skipping the model entirely:

```
❯ !git status
```

Enter `!` alone to enter **shell mode**, where every subsequent line runs as a shell command.
Press `Esc` or `Ctrl+C` on an empty prompt to exit shell mode.

### `?` Quick help

Typing `?` on an empty prompt opens a quick-help overlay without sending a message.

### Ctrl+G / Ctrl+X e — External editor

Opens `$EDITOR` (or `$VISUAL`) for composing a multi-line prompt. On save, the contents are
loaded back into the input buffer.

### Ctrl+V — Paste attachment

Pastes the clipboard content as an attachment. For images, this sends the image to Copilot
directly. For text, it pastes as normal input.

### Ctrl+X / — Slash command while typing

After starting a prompt, `Ctrl+X /` opens the slash command picker without clearing the
already-typed prompt text, so you can, e.g., change the model mid-prompt.

### Enqueue a message while Copilot is busy

Press `Ctrl+Enter` or `Ctrl+Q` to queue a follow-up message while Copilot is still generating
a response.  The queued message is shown as a notification and processed immediately after the
current response completes.

---

## 15. Slash Commands — Full Reference

All slash commands are typed directly into the input composer and submitted with `Enter`.

### Agent environment

| Command | Description |
|---------|-------------|
| `/init` | Initialize Copilot instructions for this repository (creates `.github/copilot-instructions.md`) |
| `/agent` | Browse and select from available built-in and custom agents |
| `/skills` | Toggle individual skills on/off interactively |
| `/mcp [show\|add\|edit\|delete\|disable\|enable\|auth\|reload\|search] [NAME]` | Manage MCP server configuration |
| `/plugin [marketplace\|install\|uninstall\|update\|list]` | Manage plugins |

### Models & Subagents

| Command | Description |
|---------|-------------|
| `/model` / `/models [MODEL]` | Select AI model (or "Auto" for automatic selection) |
| `/fleet [PROMPT]` | Enable parallel subagent execution of task parts |
| `/tasks` | View and manage background tasks (subagents & shell sessions) |
| `/rubber-duck [PROMPT]` | Consult the rubber-duck agent for a second opinion |

### Code

| Command | Description |
|---------|-------------|
| `/ide` | Connect to a VS Code workspace |
| `/diff` | Review changes; auto-switches to branch diff when working tree is clean |
| `/review [PROMPT]` | Run code review agent |
| `/pr [view\|create\|fix\|auto]` | Manage pull requests for current branch |
| `/lsp [show\|test\|reload\|help] [SERVER]` | Manage language server configuration |
| `/terminal-setup` | Configure terminal for multi-line input (Shift+Enter) |

### Permissions

| Command | Description |
|---------|-------------|
| `/allow-all [on\|off\|show]` | Enable / disable all-permissions mode |
| `/add-dir PATH` | Add a directory to the allowed file-access list |
| `/list-dirs` | Show all allowed directories |
| `/cwd` / `/cd [PATH]` | Change working directory or show current directory |
| `/reset-allowed-tools` | Clear in-session tool approvals |
| `/permissions [show\|reset]` | View or clear tool/path approvals |
| `/sandbox [enable\|disable]` | Enable/disable local sandboxing |

### Session

| Command | Description |
|---------|-------------|
| `/resume [ID]` / `/continue [ID]` | Switch to a different session |
| `/rename [NAME]` | Rename the current session |
| `/session` | Show session info and workspace summary |
| `/context` | Show context window token usage visualization |
| `/usage` | Display session usage metrics (credits, duration, LOC, tokens per model) |
| `/compact [FOCUS]` | Compress conversation history; optionally focus on a topic |
| `/share` | Share session to a markdown file or GitHub gist |
| `/copy` | Copy last response to clipboard |
| `/clear [PROMPT]` / `/new` / `/reset` | Start a new conversation |

### Help & Feedback

| Command | Description |
|---------|-------------|
| `/help` | Show help for interactive commands |
| `/changelog [summarize] [VERSION\|last N\|since VERSION]` | Display/summarize the CLI changelog |
| `/feedback` / `/bug` | Provide feedback or report a bug |
| `/theme` | View or configure terminal theme |
| `/update` | Update CLI to the latest version |
| `/downgrade VERSION` | Roll back to a specific CLI version (team accounts) |
| `/experimental [on\|off\|show]` | Toggle / show experimental features |
| `/instructions` | View and toggle custom instruction files |
| `/streamer-mode` | Hide model names and quota details for screen sharing |
| `/env` | Show loaded environment details (instructions, MCP, skills, agents, hooks…) |

### Other commands

| Command | Description |
|---------|-------------|
| `/exit` / `/quit` | Exit the CLI |
| `/login` | Log in to Copilot |
| `/logout` | Log out of Copilot |
| `/plan [PROMPT]` | Create implementation plan before coding |
| `/research TOPIC` | Run deep research with GitHub search + web sources |
| `/restart` | Restart CLI, preserving current session |
| `/user` | Manage GitHub user list |
| `/delegate [PROMPT]` | Delegate changes to a remote repo with an AI-generated PR |
| `/remote [on\|off]` | Manage remote steering (steer session from another device) |
| `/chronicle <standup\|tips\|improve\|reindex>` | Session history tools and insights |
| `/keep-alive [on\|off\|busy\|DURATION]` | Prevent machine sleep |
| `/app` | Launch the GitHub Copilot desktop app |
| `/ask QUESTION` | Quick side-question without adding to history *(experimental)* |
| `/after [DELAY PROMPT]` | Schedule a one-shot prompt *(experimental)* |
| `/every [INTERVAL PROMPT]` | Schedule a recurring prompt *(experimental)* |
| `/clikit [COMPONENT]` | Preview CLI UI components |
| `/extensions [manage\|mode]` | Manage CLI extensions |

---

## 16. Global Keyboard Shortcuts

| Shortcut | Action |
|----------|--------|
| `Shift+Tab` | Cycle modes: interactive → plan → autopilot → interactive |
| `Ctrl+C` | Cancel current operation / clear input. Press **twice** to exit |
| `Ctrl+D` | Shutdown |
| `Ctrl+L` | Clear the screen |
| `Ctrl+R` | Reverse-search command history |
| `Ctrl+S` | Run command while **preserving** the current input text |
| `Ctrl+T` | Toggle reasoning (thinking) display in timeline |
| `Ctrl+O` | Expand **recent** timeline items (when input is empty) |
| `Ctrl+E` | Expand **all** timeline items (when input is empty) |
| `Ctrl+G` | Edit prompt in external editor (`$EDITOR`) |
| `Ctrl+V` | Paste clipboard as attachment |
| `Ctrl+Enter` / `Ctrl+Q` | Queue a message while Copilot is busy |
| `Ctrl+X /` | Open slash command picker without clearing typed input |
| `Ctrl+X e` | Edit prompt in external editor |
| `Ctrl+X b` | Promote running task/shell command to background |
| `Ctrl+X o` | Open the most recent link from the timeline |
| `Ctrl+Z` | Suspend process to background (Unix) |
| `Shift+Enter` / `Option+Enter` (Mac) / `Alt+Enter` (Win/Linux) | Insert newline in input |
| `Esc` | Cancel the current operation |
| `↑` / `↓` | Navigate command history |
| `Tab` | Move to the next tab / accept inline completion |

---

## 17. Timeline Shortcuts

These work when the timeline is focused (cursor not in input, or when timeline is scrolled):

| Shortcut | Action |
|----------|--------|
| `Ctrl+F` | Open timeline search |
| `Ctrl+O` | Expand recent timeline items (when input is empty) |
| `Ctrl+E` | Expand all timeline items (when input is empty) |
| `Ctrl+T` | Expand / collapse reasoning blocks |
| `Page Up` / `Page Down` | Scroll timeline up / down by one page |

---

## 18. Navigation (Cursor/Editing) Shortcuts

| Shortcut | Action |
|----------|--------|
| `Ctrl+A` | Move cursor to beginning of line |
| `Ctrl+B` | Move to previous character |
| `Ctrl+E` | Move cursor to end of line |
| `Ctrl+F` | Move to next character |
| `Ctrl+H` | Delete previous character |
| `Ctrl+K` | Delete from cursor to end of line (at end of line: delete line break) |
| `Ctrl+U` | Delete from cursor to beginning of line |
| `Ctrl+W` | Delete the previous word |
| `Home` | Move to start of current visual line |
| `End` | Move to end of current visual line |
| `Ctrl+Home` | Move to start of all text |
| `Ctrl+End` | Move to end of all text |
| `Alt+←/→` (Win/Linux) / `Option+←/→` (Mac) | Move cursor by word |
| `↑` / `↓` | Navigate command history |
| `Tab` / `Ctrl+Y` | Accept current inline completion suggestion |

---

## 19. Diff Mode Shortcuts

Entered via `/diff`:

| Shortcut | Action |
|----------|--------|
| `↑` / `k` | Move selection up one line |
| `↓` / `j` | Move selection down one line |
| `←` / `h` | Jump to previous file |
| `→` / `l` | Jump to next file |
| `Home` / `g` | Jump to first line |
| `End` / `G` | Jump to last line |
| `Page Up` / `Page Down` | Scroll up / down one page |
| `Ctrl+U` / `Ctrl+D` | Scroll up / down half a page |
| `c` | Add or edit a comment on selected line |
| `s` | Show comments summary (when comments exist) |
| `b` | Toggle between unstaged and branch diff |
| `w` | Toggle hiding whitespace-only changes |
| `Enter` | Submit all comments (when comments exist) |
| `r` | Refresh diff (remote sessions only) |
| `Click` | Select clicked diff line (requires mouse support) |
| Mouse scroll | Scroll up / down |
| `Esc` / `Ctrl+C` | Exit diff mode |

---

## 20. Session Picker Shortcuts

Opened via `/resume` or `--continue`:

| Shortcut | Action |
|----------|--------|
| `↑` / `↓` | Move selection up / down |
| `Enter` | Open selected session |
| `s` | Cycle sort order: relevance → created → name → last used |
| `Tab` | Switch between local and remote session tabs |
| `d` | Delete selected session |
| `Esc` | Close the picker |

**Sort modes:**

| Mode | Description |
|------|-------------|
| `relevance` (default) | Scored by match to current working directory |
| `last used` | Most recently modified first |
| `created` | Most recently created first |
| `name` | Alphabetical; unnamed sessions at end |

Sessions open in another window float to the top in non-relevance modes.

---

## 21. Special Inline Prefixes

| Prefix | Behaviour |
|--------|-----------|
| `@path/to/file` | Inject file (or image/PDF) contents into the prompt as context |
| `#NUMBER` | Include a GitHub issue or PR in context |
| `!COMMAND` | Execute shell command directly, bypassing Copilot |
| `!` (alone) | Enter persistent shell mode |
| `?` (alone) | Open quick-help overlay |
| `/COMMAND` | Invoke slash command |

---

## 22. Context Management

### Automatic compaction

When the conversation reaches **95%** of the model's token limit, Copilot automatically
compresses history in the background without interrupting your session.  This enables
effectively unlimited session length ("infinite sessions").

### Manual compaction

```
/compact                        ← summarises with default focus
/compact focus on the auth module   ← directed summary
```

Press `Esc` while compaction is running to cancel.

### Visualisation

```
/context   ← renders a bar chart of token usage by category
/usage     ← shows credits used, session duration, LOC edited, per-model token breakdown
```

---

## 23. MCP Server Integration

Copilot CLI ships with **GitHub's MCP server** preconfigured, enabling direct interaction with
GitHub.com resources (repositories, issues, PRs, workflows, gists).

### Managing MCP servers

All management is now done **interactively inside the session** (no manual JSON editing):

| Command | Description |
|---------|-------------|
| `/mcp show` | List configured servers and their status |
| `/mcp add` | Launch an interactive form to add a new server (fill fields with Tab) |
| `/mcp search` | Browse the GitHub MCP Registry and install directly |
| `/mcp edit SERVER` | Edit a server's configuration |
| `/mcp delete SERVER` | Remove a server |
| `/mcp enable / disable SERVER` | Toggle a server |
| `/mcp auth SERVER` | Re-authenticate a server |
| `/mcp reload` | Hot-reload all servers — **no restart required** |

Config is stored in `~/.copilot/mcp-config.json` (or `$COPILOT_HOME/mcp-config.json`).

### Tool call display in timeline

Every MCP tool call is shown as a **chip** in the timeline:

```
  [⚙ github_list_issues  repo=octo-org/octo-repo  state=open]  ✔
```

The chip shows: tool name + key argument summary + status icon (`✔` / `✖` / spinner).

---

## 24. Custom Agents & Skills

### Built-in custom agents

| Agent | Role |
|-------|------|
| **Explore** | Quick codebase analysis; questions without polluting main context |
| **Task** | Runs builds, tests, linters — brief success summary, full output on failure |
| **General purpose** | Complex multi-step tasks with full toolset, separate context |
| **Code review** | Surfaces only genuine issues; minimal noise |
| **Research** | Deep research across codebase, repos, web — produces report with citations |
| **Rubber duck** | Constructive critic; consulted automatically on non-trivial tasks |

The model may automatically delegate to a subagent without being asked.

### Selecting agents

```bash
/agent                                  # interactive picker
Use the refactoring agent to …          # natural language
copilot --agent=refactor-agent …        # command-line flag
```

### Custom agent profiles

Create Markdown files in:

| Path | Scope |
|------|-------|
| `~/.copilot/agents/` | All projects |
| `.github/agents/` | Current repository |
| `.github-private` repo `/agents/` dir | Entire org/enterprise |

### Skills

Skills add specialised capabilities (instructions + scripts + resources).

```
/skills          ← toggle skills on/off with arrow keys + spacebar
```

---

## 25. File & Image Attachments

Supported types: `.jpg`, `.jpeg`, `.png`, `.gif`, `.webp`, `.pdf`, `.heic`, `.heif`

Attachment methods:
1. **`@`-mention** the path in the prompt: `Explain @diagram.png`
2. **Drag and drop** a file into the terminal session.
3. **Copy image to clipboard** then **paste** with `Ctrl+V`.

Attachments are included as base64-encoded multimodal content in the model request.

---

## 26. Background Tasks & Fleet Mode

### Background tasks

Any long-running task (e.g., a build, a test run, an autopilot job) can be promoted to the
background with `Ctrl+X b` or by appending `&` to a command.  The main session remains
interactive.

```
/tasks          ← view and manage all background tasks
```

### Fleet mode

```
/fleet [PROMPT]
```

Fleet mode spins up **parallel subagents** to work on different parts of a task
simultaneously.  Each subagent runs in its own context with its own tool permissions.
Results are collected and merged in the main session timeline.

---

## 27. Session Management

Sessions are persisted under `~/.copilot/sessions/` (or `$COPILOT_HOME/sessions/`).

| Feature | Details |
|---------|---------|
| **Auto-save** | Session state saved continuously |
| **Resume** | `copilot --resume` or `/resume` shows an interactive picker |
| **Continue last** | `copilot --continue` resumes the most recently closed session immediately |
| **Cloud sessions** | `copilot --cloud` starts a session in a cloud sandbox, resumable from any machine |
| **Rename** | `/rename [NAME]` — auto-generates a name if omitted |
| **Export** | `/share` — saves session as markdown or publishes to a GitHub gist |
| **Chronicle** | `/chronicle standup` — AI-generated standup from session history |

---

## 28. LSP (Language Server Protocol) Integration

LSP servers provide go-to-definition, hover info, and diagnostics.  Copilot CLI does **not**
bundle LSP servers; install them separately.

| Config level | File location |
|---|---|
| User (all projects) | `~/.copilot/lsp-config.json` |
| Repository | `.github/lsp.json` |

Example config:
```json
{
  "lspServers": {
    "typescript": {
      "command": "typescript-language-server",
      "args": ["--stdio"],
      "fileExtensions": { ".ts": "typescript", ".tsx": "typescript" }
    }
  }
}
```

Manage inside the session: `/lsp show|test|reload|help`

---

## 29. Security & Permission Model

### Trusted directories

On launch, Copilot asks you to confirm trust for the current folder (and all subfolders).
Copilot will only read, modify, or execute files within trusted directories.

Do **not** launch from `~` (home directory) — it would trust all your files.

### Tool gating

Every potentially-destructive tool call (shell commands, file writes, etc.) requires explicit
approval (see [§13](#13-tool-call-approval-flow)).

### Sandbox mode

Local sandboxing restricts Copilot's access to filesystem, network, and system capabilities:

```
/sandbox enable   ← activates restricted mode for current session
/sandbox disable  ← reverts; instant effect (no restart required)
```

Cloud sandboxing (`copilot --cloud`) provides fully isolated cloud-hosted environments.

### Custom instructions locations

Copilot reads and merges instructions from **all** of these (no priority fallback — all
combine):

```
CLAUDE.md
GEMINI.md
AGENTS.md                             (git root & cwd)
.github/instructions/**/*.instructions.md
.github/copilot-instructions.md
$HOME/.copilot/copilot-instructions.md
COPILOT_CUSTOM_INSTRUCTIONS_DIRS      (env var, additional directories)
```

---

## 30. Environment Variables & Config Files

| Variable | Purpose |
|----------|---------|
| `COPILOT_GITHUB_TOKEN` | Auth token (highest precedence) |
| `GH_TOKEN` | GitHub CLI token (second) |
| `GITHUB_TOKEN` | Classic GitHub token (third) |
| `COPILOT_HOME` | Override `~/.copilot/` directory |
| `EDITOR` / `VISUAL` | External editor for `Ctrl+G` |
| `FORCE_COLOR` | Force colour output |
| `NO_COLOR` | Disable all colour output |

| Config file | Purpose |
|-------------|---------|
| `~/.copilot/mcp-config.json` | MCP server definitions |
| `~/.copilot/lsp-config.json` | LSP server definitions |
| `~/.copilot/copilot-instructions.md` | User-level custom instructions |
| `~/.copilot/agents/` | User-level custom agent profiles |
| `.github/copilot-instructions.md` | Repo-level custom instructions |
| `.github/agents/` | Repo-level custom agents |
| `.github/lsp.json` | Repo-level LSP config |

---

## 31. Programmatic / Non-Interactive Mode

Pass `-p / --prompt` to run a single turn and exit:

```bash
copilot -p "Show me this week's commits and summarize them" --allow-tool='shell(git)'
copilot --prompt "Fix the bug in src/app.js" --allow-all
```

Or pipe command-line options from a script:

```bash
./build-options.sh | copilot
```

Output goes to stdout; exit code reflects success/failure.

---

## 32. Platform-Specific Behaviour

| Platform | Notes |
|----------|-------|
| **macOS** | Full feature support. `Option+←/→` for word movement. Homebrew cask recommended. |
| **Linux** | Full feature support. `Alt+←/→` for word movement. Install script or npm. |
| **Windows (PowerShell 6+)** | Full support. `Alt+←/→` for word movement. WinGet recommended. ConPTY emits `resize` events instead of SIGWINCH; both are handled. Extended-length paths supported. |
| **WSL** | Runs as Linux inside WSL — full feature support. |
| **CI / non-TTY** | Colours disabled automatically. No interactive prompts. Use `-p` flag + `--allow-all`. |

### Unicode / Nerd Fonts

- The git branch glyph `\uE0A0` (⎇) requires a **Nerd Font** patched terminal font.
- On terminals without Nerd Fonts, the branch glyph may render as a box or be absent.
- Thai, Devanagari, and other multibyte scripts are supported and preserved correctly in logs
  (fixed in v1.0.68+).

---

## 33. Summary Cheat-Sheet

```
┌────────────────────────────────────────────────────────────────────────────┐
│  GITHUB COPILOT CLI — QUICK REFERENCE                                      │
├───────────────────────────┬────────────────────────────────────────────────┤
│  LAUNCH                   │  copilot [--banner] [--experimental]           │
│  ONE-SHOT                 │  copilot -p "prompt" [--allow-all]             │
│  RESUME LAST              │  copilot --continue                            │
├───────────────────────────┼────────────────────────────────────────────────┤
│  CYCLE MODES              │  Shift+Tab  (ask → plan → autopilot)           │
│  CANCEL                   │  Esc  (or Ctrl+C once)                         │
│  EXIT                     │  Ctrl+C twice  or  /exit                       │
│  SHUTDOWN                 │  Ctrl+D                                        │
│  CLEAR SCREEN             │  Ctrl+L                                        │
│  CLEAR HISTORY            │  /clear                                        │
├───────────────────────────┼────────────────────────────────────────────────┤
│  REASONING TOGGLE         │  Ctrl+T                                        │
│  EXPAND RECENT            │  Ctrl+O  (empty input)                         │
│  EXPAND ALL               │  Ctrl+E  (empty input)                         │
│  TIMELINE SEARCH          │  Ctrl+F                                        │
│  PAGE SCROLL              │  Page Up / Page Down                           │
├───────────────────────────┼────────────────────────────────────────────────┤
│  FILE MENTION             │  @path/to/file                                 │
│  GITHUB REFERENCE         │  #NUMBER                                       │
│  SHELL BYPASS             │  !command                                      │
│  QUICK HELP               │  ?  (empty input)                              │
│  EXTERNAL EDITOR          │  Ctrl+G                                        │
│  PASTE ATTACHMENT         │  Ctrl+V                                        │
│  QUEUE MESSAGE            │  Ctrl+Enter  (while Copilot is busy)           │
├───────────────────────────┼────────────────────────────────────────────────┤
│  LINE START/END           │  Ctrl+A / Ctrl+E                               │
│  WORD JUMP                │  Alt+←/→  (Option on Mac)                     │
│  DELETE WORD              │  Ctrl+W                                        │
│  DELETE TO END            │  Ctrl+K                                        │
│  DELETE TO START          │  Ctrl+U                                        │
│  HISTORY NAVIGATE         │  ↑ / ↓                                         │
│  ACCEPT COMPLETION        │  Tab                                           │
│  MULTILINE INPUT          │  Shift+Enter                                   │
├───────────────────────────┼────────────────────────────────────────────────┤
│  MODEL                    │  /model                                        │
│  CONTEXT USAGE            │  /context  or  /usage                          │
│  COMPACT HISTORY          │  /compact [focus instructions]                 │
│  DIFF VIEW                │  /diff                                         │
│  CODE REVIEW              │  /review                                       │
│  PR MANAGEMENT            │  /pr                                           │
│  MCP SERVERS              │  /mcp add|show|search                          │
│  AGENTS                   │  /agent                                        │
│  SKILLS                   │  /skills                                       │
│  THEME                    │  /theme                                        │
│  RESUME SESSION           │  /resume                                       │
│  HELP                     │  /help                                         │
└───────────────────────────┴────────────────────────────────────────────────┘
```

---

*Report generated: 2026-07-07 — based on GitHub Copilot CLI official documentation,
`@github/copilot` npm package README, GitHub Blog changelog
(github.blog/changelog/2026-06-23-copilot-cli-new-terminal-interface-is-generally-available/),
and the GitHub Docs CLI reference at
docs.github.com/copilot/reference/copilot-cli-reference/cli-command-reference.*
