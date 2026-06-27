const START = process.hrtime.bigint();
const MODULE_LOAD_MS = process.uptime() * 1_000;
let reported = false;
let tracingEnabled = Boolean(process.env.ICOPILOT_PERF_TRACE) || process.argv.includes('--perf-trace');

export function enablePerfTrace(): void {
  tracingEnabled = true;
  process.env.ICOPILOT_PERF_TRACE = '1';
}

export function elapsedMs(): number {
  return Number(process.hrtime.bigint() - START) / 1_000_000;
}

export function reportColdStart(label = 'cold-start'): void {
  if (!tracingEnabled) return;
  process.stderr.write(`[perf] process start → ${label}: ${process.uptime().toFixed(1)}ms\n`);
}

export function markFirstPrompt(label = 'first prompt ready'): void {
  if (reported || !tracingEnabled) return;
  reported = true;
  const firstPromptMs = process.uptime() * 1_000;
  process.stderr.write(`[perf] process start → module load: ${MODULE_LOAD_MS.toFixed(1)}ms\n`);
  process.stderr.write(`[perf] module load → ${label}: ${(firstPromptMs - MODULE_LOAD_MS).toFixed(1)}ms\n`);
  process.stderr.write(`[perf] process start → ${label}: ${firstPromptMs.toFixed(1)}ms\n`);
}
