# Agent Client Protocol (ACP) Server

iCopilot v2.2 includes an Agent Client Protocol (ACP) server that enables external agents to discover and invoke iCopilot tools via a standardized JSON-RPC 2.0 interface.

## Overview

The ACP server allows external systems to:

- **Discover tools** — List all available iCopilot tools with their schemas
- **Execute tools** — Call iCopilot tools with parameters from external workflows
- **Query capabilities** — Learn supported methods and server version

This enables integration between iCopilot and external AI agents, CI/CD systems, and orchestration platforms.

## Getting started

### Enable the ACP server

```bash
icli /acp enable 5173
```

This starts the ACP server on port 5173 (default). You can specify a different port:

```bash
icli /acp enable 8080
```

### Check server status

```bash
icli /acp status
```

Output shows the running port and capabilities.

### Test with curl

```bash
curl -X POST http://localhost:5173/acp \
  -H 'Content-Type: application/json' \
  -d '{"jsonrpc":"2.0","method":"capabilities/get","id":1}'
```

Expected response:

```json
{
  "jsonrpc": "2.0",
  "result": {
    "version": "2.2.0",
    "protocolVersion": "1.0",
    "supportedMethods": ["tools/list", "tool/call", "capabilities/get"],
    "name": "iCopilot ACP Server"
  },
  "id": 1
}
```

## API Reference

### Request/Response Format

All requests and responses follow [JSON-RPC 2.0](https://www.jsonrpc.org/specification).

**Request structure:**

```json
{
  "jsonrpc": "2.0",
  "method": "namespace/method",
  "params": {},
  "id": 1
}
```

**Success response:**

```json
{
  "jsonrpc": "2.0",
  "result": {},
  "id": 1
}
```

**Error response:**

```json
{
  "jsonrpc": "2.0",
  "error": {
    "code": -32601,
    "message": "Method not found",
    "data": null
  },
  "id": 1
}
```

### Methods

#### `tools/list`

List all available iCopilot tools with their input schemas.

**Request:**

```json
{
  "jsonrpc": "2.0",
  "method": "tools/list",
  "id": 1
}
```

**Response:**

```json
{
  "jsonrpc": "2.0",
  "result": [
    {
      "name": "read_file",
      "description": "Read a file from the working directory.",
      "inputSchema": {
        "type": "object",
        "properties": {
          "path": { "type": "string" }
        },
        "required": ["path"]
      }
    },
    {
      "name": "write_file",
      "description": "Propose creating or overwriting a file. User must approve via diff preview.",
      "inputSchema": {
        "type": "object",
        "properties": {
          "path": { "type": "string" },
          "content": { "type": "string" }
        },
        "required": ["path", "content"]
      }
    }
  ],
  "id": 1
}
```

#### `tool/call`

Execute an iCopilot tool with the specified parameters.

**Request:**

```json
{
  "jsonrpc": "2.0",
  "method": "tool/call",
  "params": {
    "toolName": "read_file",
    "args": {
      "path": "src/index.ts"
    }
  },
  "id": 2
}
```

**Response (success):**

```json
{
  "jsonrpc": "2.0",
  "result": {
    "toolName": "read_file",
    "result": "export function greet(name: string): string { ... }"
  },
  "id": 2
}
```

**Response (error):**

```json
{
  "jsonrpc": "2.0",
  "error": {
    "code": -32603,
    "message": "Tool execution failed: File not found: src/index.ts",
    "data": {
      "toolName": "read_file",
      "error": "File not found: src/index.ts"
    }
  },
  "id": 2
}
```

#### `capabilities/get`

Get server capabilities and supported methods.

**Request:**

```json
{
  "jsonrpc": "2.0",
  "method": "capabilities/get",
  "id": 3
}
```

**Response:**

```json
{
  "jsonrpc": "2.0",
  "result": {
    "version": "2.2.0",
    "protocolVersion": "1.0",
    "supportedMethods": [
      "tools/list",
      "tool/call",
      "capabilities/get"
    ],
    "name": "iCopilot ACP Server"
  },
  "id": 3
}
```

## Error Codes

JSON-RPC 2.0 error codes:

| Code | Meaning | Example |
|------|---------|---------|
| `-32700` | Parse error | Invalid JSON in request body |
| `-32600` | Invalid request | Missing required fields |
| `-32601` | Method not found | Unknown method name |
| `-32602` | Invalid params | Wrong parameter types |
| `-32603` | Internal error | Tool execution failed |
| `-32001` | Not authorized | Authorization header missing |

## Integration Examples

### Python Client

```python
import requests
import json

def call_acp_method(method, params=None):
    url = "http://localhost:5173/acp"
    payload = {
        "jsonrpc": "2.0",
        "method": method,
        "params": params or {},
        "id": 1
    }
    
    response = requests.post(
        url,
        headers={"Content-Type": "application/json"},
        json=payload
    )
    
    result = response.json()
    if "error" in result and result["error"]:
        raise Exception(f"ACP error: {result['error']['message']}")
    
    return result.get("result")

# List available tools
tools = call_acp_method("tools/list")
print(f"Available tools: {[t['name'] for t in tools]}")

# Read a file
content = call_acp_method("tool/call", {
    "toolName": "read_file",
    "args": {"path": "README.md"}
})
print(f"File content: {content}")
```

### Node.js Client

```typescript
async function callAcpMethod(method: string, params?: any) {
  const response = await fetch('http://localhost:5173/acp', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      jsonrpc: '2.0',
      method,
      params,
      id: 1,
    }),
  });

  const result = await response.json();
  if (result.error) {
    throw new Error(`ACP error: ${result.error.message}`);
  }

  return result.result;
}

// List tools
const tools = await callAcpMethod('tools/list');
console.log('Available tools:', tools.map((t: any) => t.name));

// Execute a tool
const result = await callAcpMethod('tool/call', {
  toolName: 'read_file',
  args: { path: 'package.json' },
});
console.log('File content:', result);
```

### cURL Examples

**List tools:**

```bash
curl -X POST http://localhost:5173/acp \
  -H 'Content-Type: application/json' \
  -d '{
    "jsonrpc":"2.0",
    "method":"tools/list",
    "id":1
  }' | jq '.result[].name'
```

**List capabilities:**

```bash
curl -X POST http://localhost:5173/acp \
  -H 'Content-Type: application/json' \
  -d '{
    "jsonrpc":"2.0",
    "method":"capabilities/get",
    "id":1
  }'
```

**Execute tool (grep):**

```bash
curl -X POST http://localhost:5173/acp \
  -H 'Content-Type: application/json' \
  -d '{
    "jsonrpc":"2.0",
    "method":"tool/call",
    "params":{
      "toolName":"grep",
      "args":{
        "pattern":"export function",
        "path":"src"
      }
    },
    "id":1
  }' | jq '.result.result'
```

## Security

### Authentication

The ACP server respects iCopilot's existing authentication:

- If `ICOPILOT_API_KEY` is set, all endpoints require valid auth headers
- Include the key via `Authorization: Bearer <key>` or `X-API-Key: <key>`
- Without the env var, the ACP server is publicly accessible (intended for local dev/CI)

### Input Validation

- All requests are validated against JSON-RPC 2.0 schema
- Method names are restricted to alphanumeric, hyphens, underscores, forward slashes
- Tool arguments are passed through iCopilot's existing tool dispatch, which enforces:
  - Policy rules (sandbox, shell command restrictions)
  - Permission checks (role-based access control)
  - Audit logging

### Tool Isolation

Each tool invocation:

1. Validates parameters against the tool's schema
2. Checks execution policies
3. Runs in the current working directory context
4. Logs the execution to the audit trail
5. Returns sanitized output

## Command Reference

### `/acp status`

Show if ACP server is running and on which port.

```bash
icli /acp status
```

### `/acp enable [port]`

Start the ACP server on the specified port (default 5173).

```bash
icli /acp enable 5173
icli /acp enable 8080
```

### `/acp disable`

Stop the ACP server.

```bash
icli /acp disable
```

### `/acp test <method>`

Test an ACP method with sample request and show curl example.

```bash
icli /acp test tools/list
icli /acp test capabilities/get
icli /acp test tool/call
```

## Configuration

ACP can be configured in `.icopilotrc.json`:

```json
{
  "acp": {
    "enabled": false,
    "port": 5173
  }
}
```

To auto-start ACP on launch:

```json
{
  "acp": {
    "enabled": true,
    "port": 5173
  }
}
```

## Troubleshooting

### Server not starting

Check if the port is in use:

```bash
icli /acp enable 5173
# Error: Address already in use
```

Try a different port:

```bash
icli /acp enable 5174
```

### Tool execution fails

Test the tool directly with `/acp test`:

```bash
icli /acp test tool/call
```

Check audit logs for detailed errors:

```bash
icli /audit search tool/call
```

### Connection refused

Make sure the server is running:

```bash
icli /acp status
# ACP Server is currently disabled.
```

Enable it first:

```bash
icli /acp enable
```

## See also

- [JSON-RPC 2.0 Specification](https://www.jsonrpc.org/specification)
- [iCopilot public API](./api.md)
- [Tool reference](../README.md#tools)
- [Model Context Protocol](./mcp.md) — another agent integration standard
