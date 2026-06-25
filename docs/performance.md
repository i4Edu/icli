# Performance

v0.7 improves cold-start behavior by moving heavyweight dependencies off the
initial module graph.

## What shipped

- Markdown rendering (`marked` and `marked-terminal`) now loads lazily on first
  render.
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

Use `npm run build` before measuring. Compare startup by running one-shot mode
with and without `--perf-trace`, then repeat several times to smooth filesystem
cache effects. The cold-start timer starts when `src\util\perf.ts` loads and
reports just before interactive or one-shot execution begins.

| Scenario | Expected impact |
| --- | --- |
| CLI startup before markdown render | Avoids loading `marked` and terminal renderer |
| Session token estimate before priming | Avoids loading `gpt-tokenizer` |
| Large token count (>200k chars) | Moves tokenizer work to a worker thread |
