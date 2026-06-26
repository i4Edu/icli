export interface ModelRate {
  input: number;
  output: number;
}

export const RATES: Record<string, ModelRate> = {
  'gpt-4o': { input: 2.5, output: 10 },
  'gpt-4o-mini': { input: 0.15, output: 0.6 },
  'gpt-4.1': { input: 2, output: 8 },
  'gpt-4.1-mini': { input: 0.4, output: 1.6 },
  o1: { input: 15, output: 60 },
  'o1-mini': { input: 1.1, output: 4.4 },
  'o3-mini': { input: 1.1, output: 4.4 },
};

export const DEFAULT_RATE: ModelRate = { input: 1, output: 3 };

export function getRate(model: string): ModelRate {
  const normalized = model.trim().toLowerCase();
  const match = Object.entries(RATES)
    .sort(([a], [b]) => b.length - a.length)
    .find(([name]) => normalized.startsWith(name.toLowerCase()));

  return match?.[1] ?? DEFAULT_RATE;
}

export function estimateCost(model: string, inputTokens: number, outputTokens: number): number {
  const rate = getRate(model);
  return (inputTokens / 1000) * rate.input + (outputTokens / 1000) * rate.output;
}

export function formatUsd(n: number): string {
  if (n > 0 && n < 0.0001) return '<$0.0001';
  if (n < 1) return `$${n.toFixed(4)}`;
  return `$${n.toFixed(2)}`;
}
