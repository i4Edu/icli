# iCopilot — Public API

This document records iCopilot's public TypeScript API and its stability.
Modules and exports not listed here are internal and may change at any time.

## Stability tiers

| Tier | Meaning |
|---|---|
| **Stable** | Covered by SemVer. Breaking changes require a major bump. |
| **Experimental** | May break in a minor release; deprecations announced one minor in advance. |
| **Internal** | No stability guarantee. |

## Versioning policy

iCopilot follows [Semantic Versioning](https://semver.org). The CLI surface
(slash commands, flags, env vars, rc file shape) is covered by the same tiers
as the TypeScript exports.

## Modules

### `src/config.ts` — **Stable**

- `Config` interface
- `LogLevel`, `ThemeName` types
- `loadRcFile(): Partial<Config>`
- `requireToken(): string`
- `config: Config` (mutable runtime singleton)

### `src/logger.ts` — **Stable**

- `Logger` class with `debug/info/warn/error/redact`
- `logger` singleton
- `redact(text: string): string`

### `src/session/session.ts` — **Stable**

- `Session` class
- `SessionState`, `SessionListItem`, `Mode` types
- `Session.list()`, `Session.load(id)`
- Instance: `push`, `reset`, `setModel`, `setMode`, `setCwd`, `persist`,
  `tokenUsage`, `compactInto`, `toJSON`, `toMarkdown`, `shouldAutoSummarize`

### `src/session/manager.ts` — **Stable**

- `pickSession(): Promise<string | null>`
- `exportSession(session, format, outPath?): Promise<string>`

### `src/context/file-refs.ts` — **Stable**

- `parseFileRefs(input): FileRef[]`
- `renderFileRefBlock(refs): string | null`
- `FileRef` interface

### `src/context/compactor.ts` — **Stable**

- `compactSession(session, signal?): Promise<string>`

### `src/context/memory.ts` — **Stable**

- `loadMemoryBlock(cwd): string | null`

### `src/commands/slash.ts` — **Stable**

- `handleSlash(line, ctx): Promise<SlashResult>`
- `SlashContext`, `SlashResult` interfaces

### `src/api/github-models.ts` — **Stable**

- `streamChat(opts): Promise<StreamResult>`
- `client(): OpenAI` (lazy singleton)
- `StreamOpts`, `StreamResult` interfaces

### `src/tools/registry.ts` — **Stable**

- `TOOL_SCHEMAS: ChatCompletionTool[]`
- `dispatchTool(name, args): Promise<string>`
- `getAllToolSchemas(): Promise<ChatCompletionTool[]>` (Experimental, includes MCP)

### `src/tools/policy.ts` — **Stable**

- `loadPolicy(cwd): Policy`
- `shellCommandAllowed(cmd, policy)`
- `writePathAllowed(absPath, policy, cwd)`

### `src/mcp/index.ts` — **Experimental**

- `loadMcpServers(): Promise<void>`
- `getMcpTools(): Promise<{ schemas, dispatch }>`
- `shutdownMcp(): Promise<void>`

### `src/routing/router.ts` — **Experimental**

- `pickModel(sessionDefault, task): string`
- `setProfile(name)`, `getProfile()`
- `TaskKind`, `RoutingState` types

### `src/index/store.ts` — **Experimental**

- `VectorStore` class with `load/save/addAll/replaceAll/search`
- `IndexEntry`, `IndexFile` interfaces

### `src/index/indexer.ts` — **Experimental**

- `buildIndex(cwd, opts?)`

### `src/index/retrieve.ts` — **Experimental**

- `retrieve(cwd, query, topK?)`

### `src/extensions/*` — **Experimental**

Plug-in interfaces for voice, team mode, and plugin catalog. See
[`future.md`](./future.md).

## Adding a new tool

```ts
// my-tool.ts
import { TOOL_SCHEMAS, dispatchTool } from 'icopilot/dist/tools/registry.js';

TOOL_SCHEMAS.push({
  type: 'function',
  function: {
    name: 'sum_two',
    description: 'Sum two numbers and return the result.',
    parameters: {
      type: 'object',
      properties: { a: { type: 'number' }, b: { type: 'number' } },
      required: ['a', 'b'],
    },
  },
});

// Wrap dispatchTool to handle the new tool.
const inner = dispatchTool;
// (In practice, fork registry.ts or PR the tool upstream.)
```

For non-trivial cases, prefer landing the tool in the registry directly.

## Adding a slash command

Edit `src/commands/slash.ts` and add a new case to `handleSlash`. Update the
`HELP` string. Keep responses short and call into your own module rather than
inlining logic.

## Adding an MCP server

Add an entry to `.mcp.json` at the project root:

```json
{
  "servers": {
    "filesystem": {
      "command": "npx",
      "args": ["-y", "@modelcontextprotocol/server-filesystem", "."]
    }
  }
}
```

Tools surface as `mcp__filesystem__<tool>` automatically.
