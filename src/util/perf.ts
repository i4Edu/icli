const START = process.hrtime.bigint();
let reported = false;

export function elapsedMs(): number {
  return Number(process.hrtime.bigint() - START) / 1_000_000;
}

export function reportColdStart(label = 'cold-start'): void {
  if (!process.env.ICOPILOT_PERF_TRACE && !process.argv.includes('--perf-trace')) return;
  process.stderr.write(`[perf] ${label}: ${elapsedMs().toFixed(1)}ms\n`);
}

export function markFirstPrompt(label = 'startup'): void {
  if (reported) return;
  reported = true;
  reportColdStart(label);
}
