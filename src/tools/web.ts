import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { ChatCompletionTool } from 'openai/resources/chat/completions';

export interface WebFetchArgs {
  url: string;
  maxBytes?: number;
  headers?: Record<string, string>;
}

export interface WebFetchPolicy {
  allow: string[];
  deny: string[];
  defaultAllow: boolean;
}

const DEFAULT_POLICY: WebFetchPolicy = { allow: [], deny: [], defaultAllow: false };
const DEFAULT_MAX_BYTES = 200_000;
const TIMEOUT_MS = 10_000;

export function loadPolicy(): WebFetchPolicy {
  const policyPath = path.join(os.homedir(), '.icopilot', 'web-policy.json');
  if (!fs.existsSync(policyPath)) return { ...DEFAULT_POLICY };

  try {
    const parsed = JSON.parse(fs.readFileSync(policyPath, 'utf8')) as Partial<WebFetchPolicy>;
    return {
      allow: Array.isArray(parsed.allow) ? parsed.allow.filter(isString) : [],
      deny: Array.isArray(parsed.deny) ? parsed.deny.filter(isString) : [],
      defaultAllow: typeof parsed.defaultAllow === 'boolean' ? parsed.defaultAllow : false,
    };
  } catch {
    return { ...DEFAULT_POLICY };
  }
}

export function hostAllowed(host: string, policy: WebFetchPolicy): boolean {
  const normalizedHost = normalizeHost(host);
  if (!normalizedHost) return false;
  if (policy.deny.some((entry) => hostMatches(normalizedHost, entry))) return false;
  if (policy.allow.some((entry) => hostMatches(normalizedHost, entry))) return true;
  return policy.defaultAllow;
}

export async function webFetchTool(args: WebFetchArgs): Promise<string> {
  try {
    const url = new URL(args.url);
    if (url.protocol !== 'http:' && url.protocol !== 'https:') {
      return JSON.stringify({ ok: false, error: `unsupported protocol: ${url.protocol}` });
    }

    const host = url.hostname;
    if (!hostAllowed(host, loadPolicy())) {
      return JSON.stringify({
        ok: false,
        error: `host not allowed by web fetch policy: ${host}`,
      });
    }

    const maxBytes = normalizeMaxBytes(args.maxBytes);
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), TIMEOUT_MS);

    try {
      const response = await fetch(url, {
        headers: sanitizeHeaders(args.headers),
        signal: controller.signal,
      });
      const { bytes, text } = await readText(response, maxBytes);
      return JSON.stringify({
        ok: true,
        status: response.status,
        contentType: getContentType(response),
        bytes,
        text,
      });
    } finally {
      clearTimeout(timeout);
    }
  } catch (e: any) {
    return JSON.stringify({ ok: false, error: e?.message || String(e) });
  }
}

export const WEB_FETCH_SCHEMA: ChatCompletionTool = {
  type: 'function',
  function: {
    name: 'web_fetch',
    description: 'Fetch an HTTP(S) web page only when its host is allowed by the user-managed host allowlist.',
    parameters: {
      type: 'object',
      properties: {
        url: { type: 'string', description: 'HTTP or HTTPS URL to fetch.' },
        maxBytes: {
          type: 'number',
          default: DEFAULT_MAX_BYTES,
          description: 'Maximum response bytes to read before truncating.',
        },
        headers: {
          type: 'object',
          additionalProperties: { type: 'string' },
          description: 'Optional request headers.',
        },
      },
      required: ['url'],
    },
  },
};

function hostMatches(host: string, entry: string): boolean {
  const normalizedEntry = normalizeHost(entry);
  if (!normalizedEntry) return false;
  if (normalizedEntry.startsWith('*.')) {
    const suffix = normalizedEntry.slice(1);
    return host.endsWith(suffix) && host.length > suffix.length;
  }
  return host === normalizedEntry;
}

function normalizeHost(host: string): string {
  return host.trim().toLowerCase().replace(/\.$/, '');
}

function normalizeMaxBytes(maxBytes: number | undefined): number {
  if (typeof maxBytes !== 'number' || !Number.isFinite(maxBytes)) return DEFAULT_MAX_BYTES;
  return Math.max(0, Math.floor(maxBytes));
}

function sanitizeHeaders(headers: Record<string, string> | undefined): Record<string, string> | undefined {
  if (!headers) return undefined;
  return Object.fromEntries(
    Object.entries(headers).filter((entry): entry is [string, string] => isString(entry[1])),
  );
}

async function readText(response: Response, maxBytes: number): Promise<{ bytes: number; text: string }> {
  if (!response.body) {
    const responseLike = response as Response & { text?: () => Promise<string> };
    const buffer =
      typeof response.arrayBuffer === 'function'
        ? new Uint8Array(await response.arrayBuffer())
        : new TextEncoder().encode(typeof responseLike.text === 'function' ? await responseLike.text() : '');
    const slice = buffer.slice(0, maxBytes);
    return { bytes: slice.byteLength, text: new TextDecoder().decode(slice) };
  }

  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let bytes = 0;
  let reachedLimit = maxBytes === 0;

  try {
    while (bytes < maxBytes) {
      const { done, value } = await reader.read();
      if (done) break;
      const remaining = maxBytes - bytes;
      const chunk = value.byteLength > remaining ? value.slice(0, remaining) : value;
      chunks.push(chunk);
      bytes += chunk.byteLength;
      if (bytes >= maxBytes) {
        reachedLimit = true;
        break;
      }
    }
  } finally {
    if (reachedLimit) await reader.cancel();
    reader.releaseLock();
  }

  return { bytes, text: new TextDecoder().decode(concatChunks(chunks, bytes)) };
}

function getContentType(response: Response): string {
  return response.headers?.get?.('content-type') ?? '';
}

function concatChunks(chunks: Uint8Array[], bytes: number): Uint8Array {
  const buffer = new Uint8Array(bytes);
  let offset = 0;
  for (const chunk of chunks) {
    buffer.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return buffer;
}

function isString(value: unknown): value is string {
  return typeof value === 'string';
}
