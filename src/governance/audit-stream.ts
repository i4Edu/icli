import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { parse } from 'yaml';
import { config } from '../config.js';

export interface AuditStreamConfig {
  enabled: boolean;
  sinks: AuditSink[];
  batchSize?: number;
  flushIntervalMs?: number;
}

export interface AuditSink {
  type: 'file' | 'http' | 'stdout';
  config: Record<string, unknown>;
}

export interface AuditEvent {
  id: string;
  timestamp: string;
  eventType: string;
  actor: string;
  resource: string;
  action: string;
  result: string;
  metadata?: Record<string, unknown>;
}

const AUDIT_STREAM_FILE = path.join('.icopilot', 'audit-stream.yaml');
const DEFAULT_CONFIG: AuditStreamConfig = {
  enabled: false,
  sinks: [],
  batchSize: 25,
  flushIntervalMs: 5_000,
};

export class AuditStream {
  private readonly queue: AuditEvent[] = [];
  private readonly activeSinks = new Map<AuditSink['type'], AuditSink>();
  private timer: ReturnType<typeof setInterval> | undefined;
  private started = false;

  constructor(private streamConfig: AuditStreamConfig = loadAuditStreamConfig()) {
    this.streamConfig = normalizeConfig(streamConfig);
    for (const sink of this.streamConfig.sinks) {
      this.activeSinks.set(sink.type, cloneSink(sink));
    }
  }

  emit(event: AuditEvent): void {
    if (!this.streamConfig.enabled) return;
    this.queue.push(normalizeEvent(event));
    if (this.queue.length >= (this.streamConfig.batchSize ?? DEFAULT_CONFIG.batchSize ?? 25)) {
      void this.flush();
    }
  }

  async flush(): Promise<void> {
    if (!this.streamConfig.enabled || this.queue.length === 0) return;
    const batch = this.queue.splice(0, this.queue.length);
    for (const sink of this.activeSinks.values()) {
      await writeToSink(sink, batch);
    }
  }

  addSink(sink: AuditSink): void {
    const normalized = normalizeSink(sink);
    this.activeSinks.set(normalized.type, normalized);
    this.streamConfig.sinks = Array.from(this.activeSinks.values()).map((entry) =>
      cloneSink(entry),
    );
  }

  removeSink(type: AuditSink['type']): void {
    this.activeSinks.delete(type);
    this.streamConfig.sinks = Array.from(this.activeSinks.values()).map((entry) =>
      cloneSink(entry),
    );
  }

  getConfig(): AuditStreamConfig {
    return normalizeConfig(this.streamConfig);
  }

  start(): void {
    if (this.started || !this.streamConfig.enabled) return;
    this.started = true;
    const intervalMs = this.streamConfig.flushIntervalMs ?? DEFAULT_CONFIG.flushIntervalMs ?? 5_000;
    this.timer = setInterval(() => {
      void this.flush();
    }, intervalMs);
  }

  async stop(): Promise<void> {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = undefined;
    }
    this.started = false;
    await this.flush();
  }
}

export function loadAuditStreamConfig(cwd = config.cwd): AuditStreamConfig {
  const configPath = path.join(cwd, AUDIT_STREAM_FILE);
  try {
    if (!fs.existsSync(configPath)) return normalizeConfig(DEFAULT_CONFIG);
    const parsed = parse(fs.readFileSync(configPath, 'utf8')) as unknown;
    return normalizeConfig(parsed);
  } catch {
    return normalizeConfig(DEFAULT_CONFIG);
  }
}

function normalizeConfig(value: unknown): AuditStreamConfig {
  if (!isRecord(value)) return cloneConfig(DEFAULT_CONFIG);
  return {
    enabled: typeof value.enabled === 'boolean' ? value.enabled : DEFAULT_CONFIG.enabled,
    sinks: Array.isArray(value.sinks) ? value.sinks.map((sink) => normalizeSink(sink)) : [],
    batchSize: normalizePositiveInteger(value.batchSize) ?? DEFAULT_CONFIG.batchSize,
    flushIntervalMs:
      normalizePositiveInteger(value.flushIntervalMs) ?? DEFAULT_CONFIG.flushIntervalMs,
  };
}

function normalizeSink(value: unknown): AuditSink {
  if (!isRecord(value)) return { type: 'stdout', config: {} };
  const type =
    value.type === 'file' || value.type === 'http' || value.type === 'stdout'
      ? value.type
      : 'stdout';
  return {
    type,
    config: isRecord(value.config) ? cloneRecord(value.config) : {},
  };
}

function normalizeEvent(event: AuditEvent): AuditEvent {
  return {
    id: event.id.trim() || crypto.randomUUID(),
    timestamp: normalizeTimestamp(event.timestamp),
    eventType: event.eventType.trim(),
    actor: event.actor.trim(),
    resource: event.resource.trim(),
    action: event.action.trim(),
    result: event.result.trim(),
    metadata: event.metadata ? cloneRecord(event.metadata) : undefined,
  };
}

async function writeToSink(sink: AuditSink, batch: AuditEvent[]): Promise<void> {
  switch (sink.type) {
    case 'file': {
      const sinkPath =
        typeof sink.config.path === 'string'
          ? path.resolve(sink.config.path)
          : path.join(config.cwd, '.icopilot', 'audit-stream.log');
      fs.mkdirSync(path.dirname(sinkPath), { recursive: true });
      const body = batch.map((event) => JSON.stringify(event)).join('\n');
      fs.appendFileSync(sinkPath, `${body}\n`, 'utf8');
      return;
    }
    case 'stdout': {
      for (const event of batch) {
        process.stdout.write(`${JSON.stringify(event)}\n`);
      }
      return;
    }
    case 'http': {
      const url = typeof sink.config.url === 'string' ? sink.config.url : '';
      if (!url) return;
      const headers = isRecord(sink.config.headers) ? sink.config.headers : {};
      await fetch(url, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          ...Object.fromEntries(
            Object.entries(headers)
              .filter(([, value]) => typeof value === 'string')
              .map(([key, value]) => [key, value]),
          ),
        },
        body: JSON.stringify({ events: batch }),
      });
    }
  }
}

function cloneConfig(streamConfig: AuditStreamConfig): AuditStreamConfig {
  return {
    enabled: streamConfig.enabled,
    sinks: streamConfig.sinks.map((sink) => cloneSink(sink)),
    batchSize: streamConfig.batchSize,
    flushIntervalMs: streamConfig.flushIntervalMs,
  };
}

function cloneSink(sink: AuditSink): AuditSink {
  return {
    type: sink.type,
    config: cloneRecord(sink.config),
  };
}

function cloneRecord(record: Record<string, unknown>): Record<string, unknown> {
  return Object.fromEntries(
    Object.entries(record).map(([key, value]) => [key, cloneUnknown(value)]),
  );
}

function cloneUnknown(value: unknown): unknown {
  if (Array.isArray(value)) return value.map((entry) => cloneUnknown(entry));
  if (isRecord(value)) return cloneRecord(value);
  return value;
}

function normalizePositiveInteger(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) && value > 0
    ? Math.floor(value)
    : undefined;
}

function normalizeTimestamp(value: string): string {
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? new Date(parsed).toISOString() : new Date().toISOString();
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}
