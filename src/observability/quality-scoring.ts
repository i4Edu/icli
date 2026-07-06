import { theme } from '../ui/theme.js';

export interface QualityScore {
  confidence: number;
  risk: 'low' | 'medium' | 'high' | 'critical';
  factors: string[];
  recommendation?: string;
}

export interface QualityScoringOptions {
  action: 'tool' | 'file' | 'shell' | 'response';
  content: string;
  context?: string;
}

export function scoreQuality(options: QualityScoringOptions): QualityScore {
  const content = `${options.content}\n${options.context ?? ''}`.trim();
  const normalized = content.toLowerCase();
  const factors: string[] = [];
  let confidence = 0.85;
  let severity = 0;

  if (!options.content.trim()) {
    return {
      confidence: 0.15,
      risk: 'medium',
      factors: ['Empty content leaves too much ambiguity.'],
      recommendation: 'Add more detail before executing or trusting this output.',
    };
  }

  if (options.action === 'shell') {
    if (/\brm\s+-rf\b/.test(normalized) || /:\(\)\s*\{/.test(normalized)) {
      severity = Math.max(severity, 4);
      confidence = Math.min(confidence, 0.2);
      factors.push('Includes destructive shell patterns.');
    }
    if (/curl\s+[^\n|]+\|\s*(sh|bash)/.test(normalized)) {
      severity = Math.max(severity, 3);
      confidence = Math.min(confidence, 0.35);
      factors.push('Pipes remote content directly into a shell.');
    }
    if (/\bsudo\b/.test(normalized)) {
      severity = Math.max(severity, 2);
      confidence = Math.min(confidence, 0.55);
      factors.push('Requires elevated privileges.');
    }
  }

  if (/api[_-]?key|secret|token|password/.test(normalized)) {
    severity = Math.max(severity, 3);
    confidence = Math.min(confidence, 0.4);
    factors.push('References sensitive credentials or secrets.');
  }

  if (/todo|fixme|maybe|probably|guess|not sure|unclear/.test(normalized)) {
    severity = Math.max(severity, 1);
    confidence = Math.min(confidence, 0.6);
    factors.push('Contains uncertainty markers or incomplete reasoning.');
  }

  if (options.action === 'response' && /i don't know|cannot verify|unverified/.test(normalized)) {
    severity = Math.max(severity, 1);
    confidence = Math.min(confidence, 0.5);
    factors.push('Response explicitly notes unverifiable claims.');
  }

  if (options.action === 'tool' && /write|delete|overwrite|execute/.test(normalized)) {
    severity = Math.max(severity, 1);
    factors.push('Tool action can change workspace state.');
  }

  if (factors.length === 0) {
    factors.push('No major quality risks detected from the supplied content.');
  }

  const risk = riskFromSeverity(severity);
  const recommendation = recommendationForRisk(risk, options.action);

  return {
    confidence: Number(Math.max(0, Math.min(1, confidence)).toFixed(2)),
    risk,
    factors,
    recommendation,
  };
}

export function formatQualityScore(score: QualityScore): string {
  const riskLabel =
    score.risk === 'low'
      ? theme.ok(score.risk)
      : score.risk === 'medium'
        ? theme.warn(score.risk)
        : theme.err(score.risk);

  return [
    theme.brand('Quality score'),
    `  confidence: ${theme.hl(score.confidence.toFixed(2))}`,
    `  risk:       ${riskLabel}`,
    `  factors:`,
    ...score.factors.map((factor) => `    - ${factor}`),
    score.recommendation ? `  recommendation: ${theme.dim(score.recommendation)}` : undefined,
    '',
  ]
    .filter((line): line is string => typeof line === 'string')
    .join('\n');
}

function riskFromSeverity(severity: number): QualityScore['risk'] {
  if (severity >= 4) return 'critical';
  if (severity >= 3) return 'high';
  if (severity >= 1) return 'medium';
  return 'low';
}

function recommendationForRisk(
  risk: QualityScore['risk'],
  action: QualityScoringOptions['action'],
): string | undefined {
  switch (risk) {
    case 'critical':
      return `Do not run this ${action} without manual review and a safer alternative.`;
    case 'high':
      return `Review and constrain this ${action} before proceeding.`;
    case 'medium':
      return `Double-check assumptions and inputs for this ${action}.`;
    case 'low':
      return undefined;
  }
}
