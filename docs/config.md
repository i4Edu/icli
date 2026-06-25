# iCopilot configuration

iCopilot reads defaults, then `~/.icopilotrc.json`, then environment variables, then CLI flags.

## RC file

Create `~/.icopilotrc.json`:

```json
{
  "token": "ghp_...",
  "endpoint": "https://models.inference.ai.azure.com",
  "defaultModel": "gpt-4o-mini",
  "sessionDir": "C:\\Users\\you\\.terminal-copilot\\sessions",
  "verbose": false,
  "logLevel": "info",
  "sandbox": false,
  "policyPath": ".icopilot\\policy.json",
  "theme": "auto"
}
```

## Environment

`GITHUB_TOKEN`/`ICOPILOT_TOKEN`, `ICOPILOT_ENDPOINT`, `ICOPILOT_MODEL`, `ICOPILOT_SESSION_DIR`, `ICOPILOT_CTX_WINDOW`, `ICOPILOT_VERBOSE`, `ICOPILOT_LOG_LEVEL`, `ICOPILOT_SANDBOX`, `ICOPILOT_POLICY`, and `ICOPILOT_THEME`.

## CLI flags

| Flag | Description |
| --- | --- |
| `-v, --verbose` | Enable debug logging. |
| `--log-level <level>` | `debug`, `info`, `warn`, or `error`. |
| `--sandbox` | Enable sandbox mode for policy-aware features. |
| `--policy <file>` | Use a policy file, commonly `.icopilot\policy.json`. |
| `--no-color` | Disable color. |
| `--theme <name>` | `auto`, `light`, `dark`, or `none`. |

## Memory

Project memory lives at `.icopilot\memory.md`. Global memory lives at `~\.icopilot\memory.md`. Both are added to the system prompt, capped at 16 KB each.

## Theming and color

`NO_COLOR` disables color, `FORCE_COLOR` keeps it, non-TTY output disables it, and CI disables it unless `FORCE_COLOR` is set.
