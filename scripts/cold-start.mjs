#!/usr/bin/env node
/**
 * Measure cold-start latency: from `node bin/icopilot.js --help` invocation
 * to process exit. Runs N samples and prints min/median/p95/max.
 */
import { spawnSync } from 'node:child_process';

const N = Number(process.env.SAMPLES || 10);
const samples = [];

for (let i = 0; i < N; i++) {
  const t0 = process.hrtime.bigint();
  const r = spawnSync('node', ['bin/icopilot.js', '--help'], { encoding: 'utf8' });
  const t1 = process.hrtime.bigint();
  if (r.status !== 0) {
    console.error(`run ${i} failed: ${r.stderr}`);
    process.exit(1);
  }
  samples.push(Number(t1 - t0) / 1_000_000);
}

samples.sort((a, b) => a - b);
const min = samples[0];
const max = samples[samples.length - 1];
const median = samples[Math.floor(samples.length / 2)];
const p95 = samples[Math.floor(samples.length * 0.95)];

console.log(`cold-start over ${N} samples (ms):`);
console.log(`  min:    ${min.toFixed(1)}`);
console.log(`  median: ${median.toFixed(1)}`);
console.log(`  p95:    ${p95.toFixed(1)}`);
console.log(`  max:    ${max.toFixed(1)}`);
console.log(`  target: < 150`);
console.log(`  status: ${median < 150 ? 'PASS' : 'OVER'}`);
