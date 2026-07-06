import { theme } from '../ui/theme.js';

export interface ConsensusInput {
  question: string;
  responses: Array<{ source: string; answer: string; confidence: number }>;
}

export interface ConsensusResult {
  decision: string;
  confidence: number;
  agreement: number;
  dissenting: string[];
  reasoning: string;
}

export interface ConsensusConfig {
  strategy: 'majority' | 'weighted' | 'unanimous';
  minAgreement: number;
  tieBreaker: 'highest-confidence' | 'first' | 'abstain';
}

interface ResponseGroup {
  normalizedAnswer: string;
  answer: string;
  responses: ConsensusInput['responses'];
  totalConfidence: number;
}

const DEFAULT_CONSENSUS_CONFIG: ConsensusConfig = {
  strategy: 'majority',
  minAgreement: 0.5,
  tieBreaker: 'highest-confidence',
};

export class ConsensusEngine {
  evaluate(input: ConsensusInput, config: Partial<ConsensusConfig> = {}): ConsensusResult {
    const effectiveConfig = { ...DEFAULT_CONSENSUS_CONFIG, ...config };
    const decision = this.getDecision(input, effectiveConfig);
    const groups = groupResponses(input.responses);
    const winningGroup = groups.find((group) => group.answer === decision);
    const agreement = this.computeAgreement(input.responses);
    const dissenting = winningGroup
      ? input.responses
          .filter((response) => normalizeAnswer(response.answer) !== winningGroup.normalizedAnswer)
          .map((response) => response.source)
      : input.responses.map((response) => response.source);
    const confidence = winningGroup
      ? round(
          clamp(
            (winningGroup.totalConfidence / Math.max(winningGroup.responses.length, 1)) * agreement,
          ),
        )
      : 0;

    const reasoning = winningGroup
      ? `${effectiveConfig.strategy} consensus selected "${winningGroup.answer}" with ${Math.round(
          agreement * 100,
        )}% agreement across ${input.responses.length} responses.`
      : `Consensus abstained because agreement stayed below ${Math.round(
          effectiveConfig.minAgreement * 100,
        )}%.`;

    return {
      decision,
      confidence,
      agreement,
      dissenting,
      reasoning,
    };
  }

  resolveConflict(
    responses: ConsensusInput['responses'],
  ): ConsensusInput['responses'][number] | undefined {
    return [...responses].sort((left, right) => right.confidence - left.confidence)[0];
  }

  computeAgreement(responses: ConsensusInput['responses']): number {
    if (responses.length === 0) return 0;
    const groups = groupResponses(responses);
    const largestGroup = Math.max(...groups.map((group) => group.responses.length));
    return round(largestGroup / responses.length);
  }

  getDecision(input: ConsensusInput, config: Partial<ConsensusConfig> = {}): string {
    const effectiveConfig = { ...DEFAULT_CONSENSUS_CONFIG, ...config };
    const groups = groupResponses(input.responses);
    if (groups.length === 0) return 'abstain';

    let candidates: ResponseGroup[] = [];

    if (effectiveConfig.strategy === 'majority') {
      const highestCount = Math.max(...groups.map((group) => group.responses.length));
      candidates = groups.filter((group) => group.responses.length === highestCount);
    } else if (effectiveConfig.strategy === 'weighted') {
      const highestWeight = Math.max(...groups.map((group) => group.totalConfidence));
      candidates = groups.filter((group) => group.totalConfidence === highestWeight);
    } else {
      candidates = groups.length === 1 ? groups : [];
    }

    let chosenGroup: ResponseGroup | undefined = candidates[0];
    if (candidates.length > 1) {
      const resolved = this.resolveConflict(candidates.flatMap((group) => group.responses));
      chosenGroup = resolved
        ? groups.find((group) => group.normalizedAnswer === normalizeAnswer(resolved.answer))
        : undefined;
    }

    const agreement = this.computeAgreement(input.responses);
    if (!chosenGroup) {
      return effectiveConfig.tieBreaker === 'abstain'
        ? 'abstain'
        : this.breakTie(input.responses, effectiveConfig.tieBreaker);
    }

    if (agreement < effectiveConfig.minAgreement && effectiveConfig.tieBreaker === 'abstain') {
      return 'abstain';
    }

    return chosenGroup.answer;
  }

  private breakTie(
    responses: ConsensusInput['responses'],
    tieBreaker: ConsensusConfig['tieBreaker'],
  ): string {
    if (responses.length === 0) return 'abstain';
    if (tieBreaker === 'first') return responses[0]!.answer;
    if (tieBreaker === 'abstain') return 'abstain';
    return this.resolveConflict(responses)?.answer ?? 'abstain';
  }
}

export function formatConsensusResult(result: ConsensusResult): string {
  return [
    `${theme.badge('CONSENSUS')} ${theme.assistant(result.decision)}`,
    `${theme.dim('confidence:')} ${Math.round(result.confidence * 100)}%`,
    `${theme.dim('agreement:')} ${Math.round(result.agreement * 100)}%`,
    `${theme.dim('dissenting:')} ${result.dissenting.join(', ') || 'none'}`,
    `${theme.dim('reasoning:')} ${result.reasoning}`,
  ].join('\n');
}

function groupResponses(responses: ConsensusInput['responses']): ResponseGroup[] {
  const groups = new Map<string, ResponseGroup>();

  for (const response of responses) {
    const key = normalizeAnswer(response.answer);
    const existing = groups.get(key);
    if (existing) {
      existing.responses.push(response);
      existing.totalConfidence = round(existing.totalConfidence + clamp(response.confidence));
      continue;
    }

    groups.set(key, {
      normalizedAnswer: key,
      answer: response.answer,
      responses: [response],
      totalConfidence: clamp(response.confidence),
    });
  }

  return [...groups.values()];
}

function normalizeAnswer(answer: string): string {
  return answer
    .toLowerCase()
    .replace(/[^a-z0-9\s]/giu, ' ')
    .replace(/\s+/gu, ' ')
    .trim();
}

function clamp(value: number): number {
  return Math.max(0, Math.min(1, value));
}

function round(value: number): number {
  return Math.round(value * 1000) / 1000;
}
