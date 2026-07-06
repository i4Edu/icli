import fs from 'node:fs';
import path from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  ObservabilityConnector,
  formatConnectorStatus,
  loadObservabilityConfig,
} from '../../src/integrations/observability-connector.js';

const fetchMock = vi.fn<typeof fetch>();
vi.stubGlobal('fetch', fetchMock);

describe('ObservabilityConnector', () => {
  afterEach(() => {
    fetchMock.mockReset();
  });

  it('flushes metrics and spans in batches', async () => {
    fetchMock.mockResolvedValue({ ok: true, status: 202 } as Response);
    const connector = new ObservabilityConnector();
    connector.configure({
      provider: 'datadog',
      endpoint: 'https://api.example.com',
      apiKey: 'abc',
      batchSize: 2,
    });
    connector.start();

    await connector.sendMetric({ name: 'latency', value: 123, timestamp: 1, tags: ['env:test'] });
    await connector.sendSpan({
      traceId: 't1',
      spanId: 's1',
      name: 'build',
      startTime: 1,
      endTime: 2,
    });

    expect(fetchMock).toHaveBeenCalledOnce();
    expect(connector.getStatus()).toEqual(
      expect.objectContaining({
        pendingMetrics: 0,
        pendingSpans: 0,
        sentBatches: 1,
        running: true,
      }),
    );
  });

  it('requeues payloads when flush fails', async () => {
    fetchMock.mockResolvedValue({ ok: false, status: 500 } as Response);
    const connector = new ObservabilityConnector();
    connector.configure({ provider: 'splunk', endpoint: 'https://api.example.com', batchSize: 1 });

    await expect(connector.sendMetric({ name: 'errors', value: 2, timestamp: 5 })).rejects.toThrow(
      /flush failed/,
    );
    expect(connector.getStatus()).toEqual(
      expect.objectContaining({ pendingMetrics: 1, failedBatches: 1 }),
    );
  });

  it('loads config and formats connector status', () => {
    const root = path.join(process.cwd(), '.vitest-observability');
    fs.mkdirSync(path.join(root, '.icopilot'), { recursive: true });
    fs.writeFileSync(
      path.join(root, '.icopilot', 'observability.json'),
      JSON.stringify({
        provider: 'otlp',
        endpoint: 'https://collector.example.com',
        headers: { 'x-team': 'cli' },
      }),
      'utf8',
    );

    const loaded = loadObservabilityConfig(root);
    const connector = new ObservabilityConnector();
    connector.configure({ provider: 'custom', endpoint: 'https://custom.example.com' });

    expect(loaded).toEqual({
      provider: 'otlp',
      endpoint: 'https://collector.example.com',
      apiKey: undefined,
      headers: { 'x-team': 'cli' },
      batchSize: undefined,
    });
    expect(formatConnectorStatus(connector)).toContain('pendingMetrics=0');
    fs.rmSync(root, { recursive: true, force: true });
  });
});
