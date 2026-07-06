import { describe, expect, it } from 'vitest';
import { DeliveryPipeline, formatPipelineStatus } from '../../src/delivery/pipeline.js';

describe('DeliveryPipeline', () => {
  it('advances a pipeline through manual stages', () => {
    const pipelineManager = new DeliveryPipeline();
    const pipeline = pipelineManager.create('Ship release pipeline');

    const firstAdvance = pipelineManager.advance(pipeline.id);
    expect(firstAdvance?.status).toBe('running');
    expect(firstAdvance?.stages[0]?.status).toBe('running');

    const secondAdvance = pipelineManager.advance(pipeline.id);
    expect(secondAdvance?.stages[0]?.status).toBe('passed');
    expect(secondAdvance?.stages[1]?.status).toBe('running');

    const formatted = secondAdvance ? formatPipelineStatus(secondAdvance) : '';
    expect(formatted).toContain('Ship release pipeline');
    expect(formatted).toContain('code');
  });

  it('auto-advances a pipeline to completion and creates artifacts', () => {
    const pipelineManager = new DeliveryPipeline();
    const pipeline = pipelineManager.create('Release v1', { autoAdvance: true });

    const completed = pipelineManager.advance(pipeline.id);
    expect(completed?.status).toBe('passed');
    expect(completed?.completedAt).toBeDefined();
    expect(completed?.artifacts).toContain(`build:${pipeline.id}`);
    expect(completed?.artifacts).toContain(`release:${pipeline.id}`);
  });

  it('rolls back a failing stage and supports retry', () => {
    const pipelineManager = new DeliveryPipeline();
    const pipeline = pipelineManager.create('Test rollback', {
      stages: ['plan', 'fail-test', 'release'],
      rollbackOnFailure: true,
    });

    pipelineManager.advance(pipeline.id);
    pipelineManager.advance(pipeline.id);
    const failed = pipelineManager.advance(pipeline.id);

    expect(failed?.status).toBe('rolled-back');
    expect(failed?.artifacts).toContain(`rollback:${pipeline.id}`);
    expect(failed?.stages[2]?.status).toBe('skipped');

    const retried = pipelineManager.retry(pipeline.id, failed?.stages[1]?.id);
    expect(retried?.status).toBe('pending');
    expect(retried?.stages[1]?.status).toBe('pending');
  });

  it('lists only active pipelines and can abort them', () => {
    const pipelineManager = new DeliveryPipeline();
    const active = pipelineManager.create('Still running');
    const completed = pipelineManager.create('Done already', { autoAdvance: true });

    pipelineManager.advance(active.id);
    pipelineManager.advance(completed.id);

    expect(pipelineManager.listActive().map((pipeline) => pipeline.id)).toContain(active.id);
    expect(pipelineManager.listActive().map((pipeline) => pipeline.id)).not.toContain(completed.id);

    const aborted = pipelineManager.abort(active.id);
    expect(aborted?.status).toBe('aborted');
    expect(pipelineManager.listActive()).toHaveLength(0);
  });
});
