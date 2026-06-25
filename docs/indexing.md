# Workspace embeddings index

iCopilot can build a per-workspace embeddings index using the GitHub Models
`text-embedding-3-small` model. The index lives at `.icopilot/index.json`.

## Build

```text
> /index build
✔ indexed 421 files, 2,103 new chunks in 8,742ms
  /repo/.icopilot/index.json
```

Subsequent builds re-embed only files whose SHA1 changed.

## Status

```text
> /index status
  model: text-embedding-3-small
  built: 2026-06-25T07:42:11.123Z
  entries: 2103
```

## Search

```text
> /index search "streaming token loop"
src/api/github-models.ts chunk 1 (score 0.873)
  …content snippet…
```

## Defaults

- Globs: `**/*.{ts,tsx,js,jsx,md,py,go,rs,java,rb,cs,json,yaml,yml,toml}`
- Ignored: `node_modules/`, `dist/`, `.git/`, `coverage/`
- Per-file size cap: 256 KB
- Chunk size: 1,500 chars with 200-char overlap

## Architecture

- `src/index/store.ts` — JSON-on-disk vector store with cosine similarity.
- `src/index/indexer.ts` — walks files, SHA1-keyed dedupe, embeds via the
  GitHub Models embeddings endpoint.
- `src/index/retrieve.ts` — query → top-k chunks.

Retrieval is not yet wired into the chat turn automatically. To use it in
agentic code, call `retrieve(cwd, userQuery)` and inject the snippets into the
turn's system prompt or as additional `@file`-style context.
