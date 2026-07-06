import { randomUUID } from 'node:crypto';
import { theme } from '../ui/theme.js';

export type PipelineStageType = 'plan' | 'code' | 'test' | 'build' | 'release';
export type PipelineStageStatus = 'pending' | 'running' | 'passed' | 'failed' | 'skipped';
export type PipelineStatus =
  | 'pending'
  | 'running'
  | 'passed'
  | 'failed'
  | 'rolled-back'
  | 'aborted';

export interface PipelineStage {
  id: string;
  name: string;
  type: PipelineStageType;
  status: PipelineStageStatus;
  durationMs?: number;
  output?: string;
}

export interface Pipeline {
  id: string;
  goal: string;
  stages: PipelineStage[];
  status: PipelineStatus;
  startedAt: string;
  completedAt?: string;
  artifacts: string[];
}

export interface PipelineConfig {
  stages: string[];
  autoAdvance: boolean;
  rollbackOnFailure: boolean;
  notifications?: string[];
}

const DEFAULT_CONFIG: PipelineConfig = {
  stages: ['plan', 'code', 'test', 'build', 'release'],
  autoAdvance: false,
  rollbackOnFailure: true,
  notifications: [],
};

export class DeliveryPipeline {
  private readonly pipelines = new Map<string, Pipeline>();
  private readonly configs = new Map<string, PipelineConfig>();

  create(goal: string, config?: Partial<PipelineConfig>): Pipeline {
    const resolvedConfig = normalizeConfig(config);
    const pipeline: Pipeline = {
      id: randomUUID(),
      goal,
      stages: resolvedConfig.stages.map((stageName, index) => createStage(stageName, index)),
      status: 'pending',
      startedAt: new Date().toISOString(),
      artifacts: [],
    };

    this.pipelines.set(pipeline.id, structuredClone(pipeline));
    this.configs.set(pipeline.id, resolvedConfig);
    return structuredClone(pipeline);
  }

  advance(pipelineId: string): Pipeline | undefined {
    const pipeline = this.pipelines.get(pipelineId);
    if (!pipeline) return undefined;
    if (isTerminalStatus(pipeline.status)) return structuredClone(pipeline);

    const config = this.configs.get(pipelineId) ?? normalizeConfig();

    if (config.autoAdvance) {
      const next = pipeline;
      while (!isTerminalStatus(next.status)) {
        this.advanceOnce(next, config);
      }
      this.pipelines.set(pipelineId, structuredClone(next));
      return structuredClone(next);
    }

    this.advanceOnce(pipeline, config);
    this.pipelines.set(pipelineId, structuredClone(pipeline));
    return structuredClone(pipeline);
  }

  rollback(pipelineId: string): Pipeline | undefined {
    const pipeline = this.pipelines.get(pipelineId);
    if (!pipeline) return undefined;

    for (const stage of pipeline.stages) {
      if (stage.status === 'pending' || stage.status === 'running') {
        stage.status = 'skipped';
        stage.output = stage.output ?? 'Skipped after rollback.';
      }
    }

    pipeline.status = 'rolled-back';
    pipeline.completedAt = new Date().toISOString();
    pipeline.artifacts.push(`rollback:${pipeline.id}`);
    this.pipelines.set(pipelineId, structuredClone(pipeline));
    return structuredClone(pipeline);
  }

  getStatus(id: string): Pipeline | undefined {
    const pipeline = this.pipelines.get(id);
    return pipeline ? structuredClone(pipeline) : undefined;
  }

  listActive(): Pipeline[] {
    return [...this.pipelines.values()]
      .filter((pipeline) => !isTerminalStatus(pipeline.status))
      .map((pipeline) => structuredClone(pipeline));
  }

  abort(id: string): Pipeline | undefined {
    const pipeline = this.pipelines.get(id);
    if (!pipeline) return undefined;

    for (const stage of pipeline.stages) {
      if (stage.status === 'pending' || stage.status === 'running') {
        stage.status = 'skipped';
        stage.output = stage.output ?? 'Pipeline aborted before completion.';
      }
    }

    pipeline.status = 'aborted';
    pipeline.completedAt = new Date().toISOString();
    this.pipelines.set(id, structuredClone(pipeline));
    return structuredClone(pipeline);
  }

  retry(id: string, stageId?: string): Pipeline | undefined {
    const pipeline = this.pipelines.get(id);
    if (!pipeline) return undefined;

    const targetIndex = stageId
      ? pipeline.stages.findIndex((stage) => stage.id === stageId)
      : findRetryIndex(pipeline.stages);
    if (targetIndex < 0) return structuredClone(pipeline);

    for (const [index, stage] of pipeline.stages.entries()) {
      if (index < targetIndex) continue;
      stage.status = 'pending';
      stage.durationMs = undefined;
      stage.output = undefined;
    }

    pipeline.status = 'pending';
    pipeline.completedAt = undefined;
    this.pipelines.set(id, structuredClone(pipeline));
    return structuredClone(pipeline);
  }

  private advanceOnce(pipeline: Pipeline, config: PipelineConfig): void {
    const runningStage = pipeline.stages.find((stage) => stage.status === 'running');

    if (!runningStage) {
      const nextStage = pipeline.stages.find((stage) => stage.status === 'pending');
      if (!nextStage) {
        pipeline.status = 'passed';
        pipeline.completedAt = pipeline.completedAt ?? new Date().toISOString();
        return;
      }

      nextStage.status = 'running';
      nextStage.output = `Executing ${nextStage.name}.`;
      pipeline.status = 'running';
      return;
    }

    runningStage.durationMs = runningStage.durationMs ?? estimateStageDuration(runningStage.type);
    if (shouldFailStage(runningStage)) {
      runningStage.status = 'failed';
      runningStage.output = `${runningStage.name} failed validation.`;
      pipeline.status = 'failed';
      pipeline.completedAt = new Date().toISOString();
      if (config.rollbackOnFailure) {
        this.rollback(pipeline.id);
      }
      return;
    }

    runningStage.status = 'passed';
    runningStage.output = `${runningStage.name} completed successfully.`;
    appendArtifact(pipeline, runningStage);

    const nextStage = pipeline.stages.find((stage) => stage.status === 'pending');
    if (!nextStage) {
      pipeline.status = 'passed';
      pipeline.completedAt = new Date().toISOString();
      return;
    }

    nextStage.status = 'running';
    nextStage.output = `Executing ${nextStage.name}.`;
    pipeline.status = 'running';

    if (config.autoAdvance) {
      this.advanceOnce(pipeline, config);
    }
  }
}

export function formatPipelineStatus(pipeline: Pipeline): string {
  const status = colorPipelineStatus(pipeline.status);
  const stages = pipeline.stages
    .map((stage) => `${colorStageStatus(stage.status)} ${stage.name}`)
    .join(' -> ');
  return `${theme.badge('pipeline')} ${theme.hl(pipeline.goal)} ${status}\n${stages}`;
}

function normalizeConfig(config?: Partial<PipelineConfig>): PipelineConfig {
  return {
    stages: config?.stages?.length ? [...config.stages] : [...DEFAULT_CONFIG.stages],
    autoAdvance: config?.autoAdvance ?? DEFAULT_CONFIG.autoAdvance,
    rollbackOnFailure: config?.rollbackOnFailure ?? DEFAULT_CONFIG.rollbackOnFailure,
    notifications: config?.notifications
      ? [...config.notifications]
      : [...(DEFAULT_CONFIG.notifications ?? [])],
  };
}

function createStage(name: string, index: number): PipelineStage {
  const normalizedName = name.trim() || `stage-${index + 1}`;
  return {
    id: `${normalizedName.toLowerCase().replace(/[^a-z0-9]+/g, '-') || `stage-${index + 1}`}-${index + 1}`,
    name: normalizedName,
    type: inferStageType(normalizedName),
    status: 'pending',
  };
}

function inferStageType(name: string): PipelineStageType {
  const normalized = name.toLowerCase();
  if (normalized.includes('plan')) return 'plan';
  if (normalized.includes('test')) return 'test';
  if (normalized.includes('build')) return 'build';
  if (normalized.includes('release')) return 'release';
  return 'code';
}

function estimateStageDuration(type: PipelineStageType): number {
  switch (type) {
    case 'plan':
      return 250;
    case 'code':
      return 1_500;
    case 'test':
      return 2_000;
    case 'build':
      return 3_000;
    case 'release':
      return 1_000;
  }
}

function appendArtifact(pipeline: Pipeline, stage: PipelineStage): void {
  if (stage.type === 'build') {
    pipeline.artifacts.push(`build:${pipeline.id}`);
  }
  if (stage.type === 'release') {
    pipeline.artifacts.push(`release:${pipeline.id}`);
  }
}

function shouldFailStage(stage: PipelineStage): boolean {
  return /fail/i.test(stage.id) || /fail/i.test(stage.name);
}

function findRetryIndex(stages: PipelineStage[]): number {
  const explicitFailure = stages.findIndex(
    (stage) => stage.status === 'failed' || stage.status === 'skipped',
  );
  if (explicitFailure >= 0) return explicitFailure;
  return stages.findIndex((stage) => stage.status === 'running');
}

function isTerminalStatus(status: PipelineStatus): boolean {
  return (
    status === 'passed' || status === 'failed' || status === 'rolled-back' || status === 'aborted'
  );
}

function colorStageStatus(status: PipelineStageStatus): string {
  switch (status) {
    case 'passed':
      return theme.ok('passed');
    case 'failed':
      return theme.err('failed');
    case 'running':
      return theme.brand('running');
    case 'skipped':
      return theme.warn('skipped');
    case 'pending':
      return theme.dim('pending');
  }
}

function colorPipelineStatus(status: PipelineStatus): string {
  switch (status) {
    case 'passed':
      return theme.ok(status);
    case 'failed':
      return theme.err(status);
    case 'running':
      return theme.brand(status);
    case 'rolled-back':
      return theme.warn(status);
    case 'aborted':
      return theme.warn(status);
    case 'pending':
      return theme.dim(status);
  }
}
