import fs from 'node:fs';
import path from 'node:path';
import { config } from '../config.js';
import { theme } from '../ui/theme.js';

export interface ObservabilityConfig {
  provider: 'datadog' | 'splunk' | 'otlp' | 'custom';
  endpoint: string;
  apiKey?: string;
  headers?: Record<string, string>;
  batchSize?: number;
}

export interface MetricPoint {
  name: string;
  value: number;
  timestamp: number;
  tags?: string[];
}

export interface SpanData {
  traceId: string;
  spanId: string;
  name: string;
  startTime: number;
  endTime: number;
  attributes?: Record<string, string | number | boolean>;
}

export interface ConnectorStatus {
  running: boolean;
  provider?: ObservabilityConfig['provider'];
  pendingMetrics: number;
  pendingSpans: number;
  sentBatches: number;
  failedBatches: number;
  lastFlushAt?: number;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function isStringRecord(value: unknown): value is Record<string, string> {
  return isRecord(value) && Object.values(value).every((entry) => typeof entry === 'string');
}

function configPath(cwd: string): string {
  return path.join(cwd, '.icopilot', 'observability.json');
}

function normalizeBatchSize(batchSize?: number): number {
  return typeof batchSize === 'number' && Number.isFinite(batchSize) && batchSize > 0
    ? Math.floor(batchSize)
    : 25;
}

function buildHeaders(observabilityConfig: ObservabilityConfig): Record<string, string> {
  const headers: Record<string, string> = {
    'content-type': 'application/json',
    ...(observabilityConfig.headers ?? {}),
  };
  if (!observabilityConfig.apiKey) return headers;
  switch (observabilityConfig.provider) {
    case 'datadog':
      headers['DD-API-KEY'] = observabilityConfig.apiKey;
      break;
    case 'splunk':
      headers.Authorization = `Splunk ${observabilityConfig.apiKey}`;
      break;
    default:
      headers.Authorization = 'Bearer '.concat(observabilityConfig.apiKey);
      break;
  }
  return headers;
}

function isObservabilityConfig(value: unknown): value is ObservabilityConfig {
  return (
    isRecord(value) &&
    (value.provider === 'datadog' ||
      value.provider === 'splunk' ||
      value.provider === 'otlp' ||
      value.provider === 'custom') &&
    typeof value.endpoint === 'string'
  );
}

export class ObservabilityConnector {
  private observabilityConfig: ObservabilityConfig | null = null;
  private readonly metrics: MetricPoint[] = [];
  private readonly spans: SpanData[] = [];
  private running = false;
  private sentBatches = 0;
  private failedBatches = 0;
  private lastFlushAt?: number;

  configure(nextConfig: ObservabilityConfig): void {
    this.observabilityConfig = {
      ...nextConfig,
      headers: nextConfig.headers ? { ...nextConfig.headers } : undefined,
      batchSize: normalizeBatchSize(nextConfig.batchSize),
    };
  }

  async sendMetric(point: MetricPoint): Promise<void> {
    this.metrics.push({ ...point, tags: point.tags ? [...point.tags] : undefined });
    await this.flushIfNeeded();
  }

  async sendSpan(span: SpanData): Promise<void> {
    this.spans.push({ ...span, attributes: span.attributes ? { ...span.attributes } : undefined });
    await this.flushIfNeeded();
  }

  async flush(): Promise<void> {
    if (!this.observabilityConfig || (!this.metrics.length && !this.spans.length)) return;
    const payload = {
      provider: this.observabilityConfig.provider,
      metrics: this.metrics.splice(0, this.metrics.length),
      spans: this.spans.splice(0, this.spans.length),
      sentAt: Date.now(),
    };
    try {
      const response = await fetch(this.observabilityConfig.endpoint, {
        method: 'POST',
        headers: buildHeaders(this.observabilityConfig),
        body: JSON.stringify(payload),
      });
      if (!response.ok) {
        throw new Error('flush failed with status '.concat(String(response.status)));
      }
      this.sentBatches += 1;
      this.lastFlushAt = Date.now();
    } catch (error) {
      this.failedBatches += 1;
      this.metrics.unshift(...payload.metrics);
      this.spans.unshift(...payload.spans);
      throw error;
    }
  }

  getStatus(): ConnectorStatus {
    return {
      running: this.running,
      provider: this.observabilityConfig?.provider,
      pendingMetrics: this.metrics.length,
      pendingSpans: this.spans.length,
      sentBatches: this.sentBatches,
      failedBatches: this.failedBatches,
      lastFlushAt: this.lastFlushAt,
    };
  }

  start(): void {
    this.running = true;
  }

  async stop(): Promise<void> {
    await this.flush();
    this.running = false;
  }

  private async flushIfNeeded(): Promise<void> {
    const size = normalizeBatchSize(this.observabilityConfig?.batchSize);
    if (!this.running) this.running = true;
    if (this.metrics.length + this.spans.length >= size) {
      await this.flush();
    }
  }
}

export function loadObservabilityConfig(cwd = config.cwd): ObservabilityConfig | null {
  const filePath = configPath(cwd);
  try {
    if (!fs.existsSync(filePath)) return null;
    const parsed = JSON.parse(fs.readFileSync(filePath, 'utf8')) as unknown;
    if (!isObservabilityConfig(parsed)) return null;
    return {
      provider: parsed.provider,
      endpoint: parsed.endpoint,
      apiKey: typeof parsed.apiKey === 'string' ? parsed.apiKey : undefined,
      headers: isStringRecord(parsed.headers) ? { ...parsed.headers } : undefined,
      batchSize: typeof parsed.batchSize === 'number' ? parsed.batchSize : undefined,
    };
  } catch {
    return null;
  }
}

export function formatConnectorStatus(connector: ObservabilityConnector): string {
  const status = connector.getStatus();
  const health = status.failedBatches === 0 ? theme.ok('healthy') : theme.warn('degraded');
  return [
    theme.badge(status.provider?.toUpperCase() ?? 'OBS').concat(' ', health),
    'running='.concat(String(status.running)),
    'pendingMetrics='.concat(String(status.pendingMetrics)),
    'pendingSpans='.concat(String(status.pendingSpans)),
    'sentBatches='.concat(String(status.sentBatches)),
    'failedBatches='.concat(String(status.failedBatches)),
  ].join(' ');
}
