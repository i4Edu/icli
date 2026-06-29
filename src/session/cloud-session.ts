import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import type { ChatCompletionMessageParam } from 'openai/resources/chat/completions';
import type { Session, SessionState } from './session.js';

const CLOUD_STORE_VERSION = 1;
const CLOUD_SESSIONS_PATH_ENV = 'ICOPILOT_CLOUD_SESSIONS_PATH';

export interface CloudSessionConfig {
  endpoint: string;
  apiKey?: string;
  sessionId?: string;
}

export interface CloudSessionCreateOptions {
  name?: string;
}

export interface CloudSessionMessage {
  id: string;
  role: string;
  content: string;
  createdAt: string;
}

export interface CloudSessionRecord {
  id: string;
  name: string;
  endpoint: string;
  status: 'connected' | 'idle';
  createdAt: string;
  updatedAt: string;
  lastSyncedAt?: string;
  messageCount: number;
  lastMessage?: string;
  messages: CloudSessionMessage[];
  snapshot?: SessionState;
}

export interface CloudSessionStatus {
  id: string;
  exists: boolean;
  status: 'connected' | 'idle' | 'missing';
  updatedAt?: string;
  lastSyncedAt?: string;
  messageCount: number;
}

interface CloudSessionStore {
  version: number;
  currentSessionId?: string;
  sessions: CloudSessionRecord[];
}

interface CloudSendResult {
  sessionId: string;
  response: string;
  messageCount: number;
}

class SimulatedCloudHttpClient {
  constructor(private readonly filePath: string) {}

  async create(
    config: CloudSessionConfig,
    opts?: CloudSessionCreateOptions,
  ): Promise<CloudSessionRecord> {
    return this.mutate((store) => {
      const now = new Date().toISOString();
      const record: CloudSessionRecord = {
        id: randomUUID(),
        name: opts?.name?.trim() || `cloud-${new Date(now).toISOString().slice(0, 19)}`,
        endpoint: config.endpoint,
        status: 'connected',
        createdAt: now,
        updatedAt: now,
        messageCount: 0,
        messages: [],
      };
      store.currentSessionId = record.id;
      for (const session of store.sessions) session.status = 'idle';
      store.sessions.unshift(record);
      return cloneRecord(record);
    });
  }

  async connect(sessionId: string): Promise<CloudSessionRecord> {
    return this.mutate((store) => {
      const session = store.sessions.find((entry) => entry.id === sessionId);
      if (!session) throw new Error(`Cloud session not found: ${sessionId}`);
      const now = new Date().toISOString();
      store.currentSessionId = sessionId;
      for (const entry of store.sessions)
        entry.status = entry.id === sessionId ? 'connected' : 'idle';
      session.updatedAt = now;
      return cloneRecord(session);
    });
  }

  async disconnect(): Promise<void> {
    await this.mutate((store) => {
      store.currentSessionId = undefined;
      for (const session of store.sessions) session.status = 'idle';
      return undefined;
    });
  }

  async send(sessionId: string, message: string): Promise<CloudSendResult> {
    return this.mutate((store) => {
      const session = store.sessions.find((entry) => entry.id === sessionId);
      if (!session) throw new Error(`Cloud session not found: ${sessionId}`);
      const now = new Date().toISOString();
      const reply = `[simulated-cloud] received: ${message}`;
      const outgoing: CloudSessionMessage[] = [
        { id: randomUUID(), role: 'user', content: message, createdAt: now },
        { id: randomUUID(), role: 'assistant', content: reply, createdAt: now },
      ];
      session.messages.push(...outgoing);
      if (session.snapshot) {
        session.snapshot.messages.push(
          { role: 'user', content: message },
          { role: 'assistant', content: reply },
        );
      }
      session.messageCount = session.messages.length;
      session.lastMessage = reply;
      session.updatedAt = now;
      return {
        sessionId: session.id,
        response: reply,
        messageCount: session.messageCount,
      };
    });
  }

  async list(): Promise<CloudSessionRecord[]> {
    const store = this.read();
    return store.sessions
      .map((session) => cloneRecord(session))
      .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  }

  async destroy(sessionId: string): Promise<boolean> {
    return this.mutate((store) => {
      const before = store.sessions.length;
      store.sessions = store.sessions.filter((entry) => entry.id !== sessionId);
      if (store.currentSessionId === sessionId) store.currentSessionId = undefined;
      return store.sessions.length !== before;
    });
  }

  async getStatus(sessionId: string): Promise<CloudSessionStatus> {
    const store = this.read();
    const session = store.sessions.find((entry) => entry.id === sessionId);
    if (!session) {
      return { id: sessionId, exists: false, status: 'missing', messageCount: 0 };
    }
    return {
      id: session.id,
      exists: true,
      status: session.status,
      updatedAt: session.updatedAt,
      lastSyncedAt: session.lastSyncedAt,
      messageCount: session.messageCount,
    };
  }

  async sync(sessionId: string, localSession: Session): Promise<CloudSessionRecord> {
    return this.mutate((store) => {
      const session = store.sessions.find((entry) => entry.id === sessionId);
      if (!session) throw new Error(`Cloud session not found: ${sessionId}`);
      const now = new Date().toISOString();
      session.snapshot = cloneState(localSession.state);
      session.messages = localSession.state.messages.map(toCloudMessage);
      session.messageCount = session.messages.length;
      session.lastMessage = session.messages.at(-1)?.content;
      session.lastSyncedAt = now;
      session.updatedAt = now;
      session.status = store.currentSessionId === sessionId ? 'connected' : session.status;
      return cloneRecord(session);
    });
  }

  currentSessionId(): string | undefined {
    return this.read().currentSessionId;
  }

  private mutate<T>(operation: (store: CloudSessionStore) => T): T {
    const store = this.read();
    const result = operation(store);
    this.write(store);
    return result;
  }

  private read(): CloudSessionStore {
    ensureParentDirectory(this.filePath);
    if (!fs.existsSync(this.filePath)) {
      return { version: CLOUD_STORE_VERSION, sessions: [] };
    }
    try {
      const parsed = JSON.parse(
        fs.readFileSync(this.filePath, 'utf8'),
      ) as Partial<CloudSessionStore>;
      if (!parsed || typeof parsed !== 'object')
        return { version: CLOUD_STORE_VERSION, sessions: [] };
      return {
        version: CLOUD_STORE_VERSION,
        currentSessionId:
          typeof parsed.currentSessionId === 'string' ? parsed.currentSessionId : undefined,
        sessions: Array.isArray(parsed.sessions)
          ? parsed.sessions.map(normalizeRecord).filter(isPresent)
          : [],
      };
    } catch {
      return { version: CLOUD_STORE_VERSION, sessions: [] };
    }
  }

  private write(store: CloudSessionStore) {
    ensureParentDirectory(this.filePath);
    fs.writeFileSync(this.filePath, JSON.stringify(store, null, 2), 'utf8');
  }
}

export class CloudSession {
  private readonly client: SimulatedCloudHttpClient;
  private currentId?: string;

  constructor(private readonly config: CloudSessionConfig) {
    this.currentId = config.sessionId;
    this.client = new SimulatedCloudHttpClient(resolveCloudSessionsPath());
  }

  async create(opts?: CloudSessionCreateOptions): Promise<CloudSessionRecord> {
    const session = await this.client.create(this.config, opts);
    this.currentId = session.id;
    return session;
  }

  async connect(sessionId: string): Promise<CloudSessionRecord> {
    const session = await this.client.connect(sessionId);
    this.currentId = session.id;
    return session;
  }

  async disconnect(): Promise<void> {
    await this.client.disconnect();
    this.currentId = undefined;
  }

  async send(message: string): Promise<CloudSendResult> {
    const sessionId = this.getConnectedSessionId();
    if (!sessionId) throw new Error('No cloud session connected.');
    return this.client.send(sessionId, message);
  }

  async list(): Promise<CloudSessionRecord[]> {
    return this.client.list();
  }

  async destroy(sessionId: string): Promise<boolean> {
    const destroyed = await this.client.destroy(sessionId);
    if (destroyed && this.currentId === sessionId) this.currentId = undefined;
    return destroyed;
  }

  async getStatus(sessionId: string): Promise<CloudSessionStatus> {
    return this.client.getStatus(sessionId);
  }

  async sync(sessionId: string, localSession: Session): Promise<CloudSessionRecord> {
    const synced = await this.client.sync(sessionId, localSession);
    if (!this.currentId) this.currentId = sessionId;
    return synced;
  }

  getConnectedSessionId(): string | undefined {
    return this.currentId || this.client.currentSessionId();
  }
}

function resolveCloudSessionsPath(): string {
  return (
    process.env[CLOUD_SESSIONS_PATH_ENV] ||
    path.join(os.homedir(), '.icopilot', 'cloud-sessions.json')
  );
}

function ensureParentDirectory(filePath: string) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
}

function normalizeRecord(record: unknown): CloudSessionRecord | null {
  if (!record || typeof record !== 'object') return null;
  const candidate = record as Partial<CloudSessionRecord>;
  if (typeof candidate.id !== 'string') return null;
  return {
    id: candidate.id,
    name:
      typeof candidate.name === 'string' && candidate.name.trim() ? candidate.name : candidate.id,
    endpoint: typeof candidate.endpoint === 'string' ? candidate.endpoint : '',
    status: candidate.status === 'connected' ? 'connected' : 'idle',
    createdAt:
      typeof candidate.createdAt === 'string' ? candidate.createdAt : new Date().toISOString(),
    updatedAt:
      typeof candidate.updatedAt === 'string' ? candidate.updatedAt : new Date().toISOString(),
    lastSyncedAt: typeof candidate.lastSyncedAt === 'string' ? candidate.lastSyncedAt : undefined,
    messageCount: typeof candidate.messageCount === 'number' ? candidate.messageCount : 0,
    lastMessage: typeof candidate.lastMessage === 'string' ? candidate.lastMessage : undefined,
    messages: Array.isArray(candidate.messages)
      ? candidate.messages.map(normalizeMessage).filter(isPresent)
      : [],
    snapshot: candidate.snapshot ? cloneState(candidate.snapshot) : undefined,
  };
}

function normalizeMessage(message: unknown): CloudSessionMessage | null {
  if (!message || typeof message !== 'object') return null;
  const candidate = message as Partial<CloudSessionMessage>;
  if (typeof candidate.id !== 'string' || typeof candidate.content !== 'string') return null;
  return {
    id: candidate.id,
    role: typeof candidate.role === 'string' ? candidate.role : 'message',
    content: candidate.content,
    createdAt:
      typeof candidate.createdAt === 'string' ? candidate.createdAt : new Date().toISOString(),
  };
}

function toCloudMessage(message: ChatCompletionMessageParam): CloudSessionMessage {
  return {
    id: randomUUID(),
    role: typeof message.role === 'string' ? message.role : 'message',
    content: contentToText(message.content),
    createdAt: new Date().toISOString(),
  };
}

function contentToText(content: unknown): string {
  if (typeof content === 'string') return content;
  if (Array.isArray(content)) {
    return content
      .map((part: any) => {
        if (typeof part?.text === 'string') return part.text;
        if (typeof part?.type === 'string') return JSON.stringify(part);
        return '';
      })
      .filter(Boolean)
      .join('\n');
  }
  if (content == null) return '';
  return JSON.stringify(content, null, 2);
}

function cloneRecord(record: CloudSessionRecord): CloudSessionRecord {
  return {
    ...record,
    messages: record.messages.map((message) => ({ ...message })),
    snapshot: record.snapshot ? cloneState(record.snapshot) : undefined,
  };
}

function cloneState(state: SessionState): SessionState {
  return JSON.parse(JSON.stringify(state)) as SessionState;
}

function isPresent<T>(value: T | null): value is T {
  return value !== null;
}
