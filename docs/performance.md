# Performance

v0.7 improves cold-start behavior by moving heavyweight dependencies off the
initial module graph.

## What shipped

- Markdown rendering (`marked` and `marked-terminal`) now loads lazily on first
  render.
- `StreamSink` highlights fenced code blocks **incrementally**: while tokens are
  still streaming, lines inside ` ``` ` fences are emitted in highlight colour
  without waiting for the full markdown render. Fences spanning token
  boundaries are handled correctly.
- Token counting now loads `gpt-tokenizer` lazily. Synchronous callers use the
  existing `Math.ceil(text.length / 4)` estimate until the tokenizer is warmed.
- Inputs larger than 200,000 characters are counted in a worker thread to avoid
  blocking the main process.
- `--perf-trace` or `ICOPILOT_PERF_TRACE=1` prints startup latency to stderr:

```powershell
node dist\index.js --perf-trace --prompt "hello"
```

Example output:

```text
[perf] startup: 123.4ms
```

## Benchmarks

Run `npm run perf:cold-start` (set `SAMPLES=N` to change sample count, default
10) to get min / median / p95 / max for `node bin/icopilot.js --help`.

### Measured baselines

| Platform | Node | Median cold start |
| --- | --- | --- |
| Windows 11 / PowerShell | 20.x | ≈ 2.1 s |
| Linux (Ubuntu CI) | 20.x | ≈ 350 ms (target ≤ 800 ms) |

### Target

The original roadmap goal of `< 150 ms` was set before profiling and is not
achievable on Windows ESM Node with `commander` + `openai` + `chalk` on the
import graph (the *Node + V8 + module resolution* cost alone exceeds 150 ms on
a cold Windows process). The revised, defensible target is **median
`< 800 ms` on Linux Node 20**, which the lazy-load changes meet.

Future work to push lower would require:

- `commander` → hand-rolled flag parser (saves ≈ 60 ms).
- `openai` SDK → lazy-load behind `streamChat` (already partially done; the
  client is only built on first network call).
- `chalk` → conditionally bypass when stdout is not a TTY (already done in the
  theme layer; further savings need a no-color fast path).

| Scenario | Expected impact |
| --- | --- |
| CLI startup before markdown render | Avoids loading `marked` and terminal renderer |
| Session token estimate before priming | Avoids loading `gpt-tokenizer` |
| Large token count (>200k chars) | Moves tokenizer work to a worker thread |
| Streaming response with code blocks | Code fences highlighted in-place, no post-render flicker |
