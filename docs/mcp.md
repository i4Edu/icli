# MCP tools

iCopilot can load Model Context Protocol servers and expose their tools to the model.

## Configuration

User-level servers live in `~/.icopilot/mcp.json`. Project-level servers live in `.mcp.json` at the current working directory and override user servers with the same name.

```json
{
  "servers": {
    "filesystem": {
      "command": "npx",
      "args": ["-y", "@modelcontextprotocol/server-filesystem", "."],
      "cwd": "e:\\AI\\icli",
      "env": {
        "EXAMPLE": "value"
      }
    }
  }
}
```

Each server entry supports:

- `command`: executable to spawn
- `args`: optional argument array
- `env`: optional environment variables
- `cwd`: optional working directory

## Tool names

MCP tools are namespaced before they are sent to the model:

```text
mcp__<server>__<tool>
```

For example, a `read_file` tool from a server named `filesystem` becomes `mcp__filesystem__read_file`.

If no MCP config exists, iCopilot starts normally with no MCP tools.
