import fs from 'node:fs';
import http from 'node:http';
import https from 'node:https';
import os from 'node:os';
import path from 'node:path';
import { ProxyAgent } from 'proxy-agent';
import { config } from '../config.js';

export interface ProxyAuth {
  username: string;
  password?: string;
}

export interface ProxyConfig {
  type: 'http' | 'https' | 'socks5';
  host: string;
  port: number;
  auth?: ProxyAuth;
  noProxy?: string[];
}

export interface ProxyTestResult {
  ok: boolean;
  url: string;
  proxied: boolean;
  status?: number;
  error?: string;
}

type ProxySource = 'env' | 'file' | null;

const PROXY_PATH_ENV = 'ICOPILOT_PROXY_PATH';

export class ProxyManager {
  private static readonly singleton = new ProxyManager();

  private currentConfig: ProxyConfig | null = null;
  private currentSource: ProxySource = null;
  private cachedAgent: ProxyAgent | null = null;
  private cachedAgentKey: string | null = null;

  static shared(): ProxyManager {
    return ProxyManager.singleton;
  }

  static parseProxyUrl(raw: string): ProxyConfig {
    let parsed: URL;
    try {
      parsed = new URL(raw);
    } catch {
      throw new Error('proxy URL must be a valid absolute URL');
    }

    const type = protocolToType(parsed.protocol);
    const host = parsed.hostname.trim();
    if (!host) throw new Error('proxy host is required');

    const port = parsed.port ? Number(parsed.port) : defaultPortForType(type);
    if (!Number.isInteger(port) || port < 1 || port > 65_535) {
      throw new Error('proxy port must be between 1 and 65535');
    }

    const auth =
      parsed.username.length > 0
        ? {
            username: decodeURIComponent(parsed.username),
            ...(parsed.password
              ? { password: decodeURIComponent(parsed.password) }
              : {}),
          }
        : undefined;

    return { type, host, port, ...(auth ? { auth } : {}) };
  }

  loadConfig(): ProxyConfig | null {
    const envConfig = readEnvProxyConfig();
    const fileConfig = envConfig ? null : readProxyConfigFile(this.configPath());
    const noProxy = readNoProxyEnv();

    const active = cloneConfig(envConfig ?? fileConfig);
    if (active && noProxy !== undefined) {
      active.noProxy = noProxy;
    }

    this.currentConfig = active;
    this.currentSource = envConfig ? 'env' : fileConfig ? 'file' : null;
    return cloneConfig(active);
  }

  setProxy(config: ProxyConfig): ProxyConfig {
    const normalized = normalizeProxyConfig(config);
    const file = this.configPath();
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, `${JSON.stringify(normalized, null, 2)}\n`, 'utf8');
    this.currentConfig = cloneConfig(normalized);
    this.currentSource = 'file';
    this.resetAgentCache();
    return cloneConfig(normalized)!;
  }

  clearProxy(): void {
    const file = this.configPath();
    fs.rmSync(file, { force: true });
    this.currentConfig = null;
    this.currentSource = null;
    this.resetAgentCache();
  }

  getAgent(targetUrl?: string): ProxyAgent | undefined {
    const active = this.loadConfig();
    if (!active) return undefined;
    if (targetUrl && !this.isProxied(targetUrl, active)) return undefined;

    const agentKey = JSON.stringify(active);
    if (this.cachedAgent && this.cachedAgentKey === agentKey) {
      return this.cachedAgent;
    }

    const proxyUrl = proxyConfigToUrl(active);
    this.cachedAgent = new ProxyAgent({
      getProxyForUrl: (url) => (this.isProxied(url, active) ? proxyUrl : ''),
    });
    this.cachedAgentKey = agentKey;
    return this.cachedAgent;
  }

  isProxied(targetUrl: string, active = this.loadConfig()): boolean {
    if (!active) return false;

    let parsed: URL;
    try {
      parsed = new URL(targetUrl);
    } catch {
      return false;
    }

    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return false;
    return !matchesNoProxy(parsed, active.noProxy ?? []);
  }

  async testConnection(targetUrl = config.endpoint): Promise<ProxyTestResult> {
    const proxied = this.isProxied(targetUrl);
    let parsed: URL;
    try {
      parsed = new URL(targetUrl);
    } catch {
      return { ok: false, proxied, url: targetUrl, error: 'invalid target URL' };
    }

    const agent = this.getAgent(targetUrl);
    const transport = parsed.protocol === 'http:' ? http : https;

    return new Promise<ProxyTestResult>((resolve) => {
      const req = transport.request(
        parsed,
        {
          method: 'GET',
          agent,
          headers: { 'user-agent': 'icopilot-proxy-test/1.0' },
          timeout: 5_000,
        },
        (res) => {
          res.resume();
          resolve({
            ok: true,
            proxied,
            status: res.statusCode,
            url: targetUrl,
          });
        },
      );

      req.on('timeout', () => req.destroy(new Error('request timed out')));
      req.on('error', (error) => {
        resolve({
          ok: false,
          proxied,
          url: targetUrl,
          error: error.message,
        });
      });
      req.end();
    });
  }

  getSource(): ProxySource {
    return this.currentSource;
  }

  getConfigPath(): string {
    return this.configPath();
  }

  private configPath(): string {
    return process.env[PROXY_PATH_ENV] || path.join(os.homedir(), '.icopilot', 'proxy.json');
  }

  private resetAgentCache(): void {
    this.cachedAgent?.destroy();
    this.cachedAgent = null;
    this.cachedAgentKey = null;
  }
}

function readEnvProxyConfig(): ProxyConfig | null {
  const raw =
    process.env.HTTPS_PROXY ??
    process.env.https_proxy ??
    process.env.HTTP_PROXY ??
    process.env.http_proxy;
  if (!raw) return null;
  return normalizeProxyConfig(ProxyManager.parseProxyUrl(raw));
}

function readNoProxyEnv(): string[] | undefined {
  const raw = process.env.NO_PROXY ?? process.env.no_proxy;
  if (raw === undefined) return undefined;
  return parseNoProxy(raw);
}

function readProxyConfigFile(file: string): ProxyConfig | null {
  if (!fs.existsSync(file)) return null;

  try {
    const parsed = JSON.parse(fs.readFileSync(file, 'utf8')) as unknown;
    return normalizeProxyConfig(parsed);
  } catch {
    return null;
  }
}

function normalizeProxyConfig(value: unknown): ProxyConfig {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error('proxy config must be an object');
  }

  const record = value as Record<string, unknown>;
  const type = normalizeProxyType(record.type);
  if (!type) throw new Error('proxy type must be http, https, or socks5');

  const host = typeof record.host === 'string' ? record.host.trim() : '';
  if (!host) throw new Error('proxy host is required');

  const port = typeof record.port === 'number' ? record.port : Number(record.port);
  if (!Number.isInteger(port) || port < 1 || port > 65_535) {
    throw new Error('proxy port must be between 1 and 65535');
  }

  const auth = normalizeProxyAuth(record.auth);
  const noProxy = normalizeNoProxy(record.noProxy);

  return {
    type,
    host,
    port,
    ...(auth ? { auth } : {}),
    ...(noProxy.length ? { noProxy } : {}),
  };
}

function normalizeProxyType(value: unknown): ProxyConfig['type'] | null {
  if (value === 'http' || value === 'https' || value === 'socks5') return value;
  return null;
}

function normalizeProxyAuth(value: unknown): ProxyAuth | undefined {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return undefined;
  const auth = value as Record<string, unknown>;
  const username = typeof auth.username === 'string' ? auth.username : '';
  if (!username) return undefined;
  const password = typeof auth.password === 'string' ? auth.password : undefined;
  return password ? { username, password } : { username };
}

function normalizeNoProxy(value: unknown): string[] {
  if (typeof value === 'string') return parseNoProxy(value);
  if (!Array.isArray(value)) return [];
  return value
    .filter((entry): entry is string => typeof entry === 'string')
    .map((entry) => entry.trim())
    .filter(Boolean);
}

function parseNoProxy(raw: string): string[] {
  return raw
    .split(',')
    .map((entry) => entry.trim())
    .filter(Boolean);
}

function protocolToType(protocol: string): ProxyConfig['type'] {
  switch (protocol.toLowerCase()) {
    case 'http:':
      return 'http';
    case 'https:':
      return 'https';
    case 'socks5:':
    case 'socks:':
      return 'socks5';
    default:
      throw new Error('proxy protocol must be http, https, or socks5');
  }
}

function defaultPortForType(type: ProxyConfig['type']): number {
  switch (type) {
    case 'http':
      return 80;
    case 'https':
      return 443;
    case 'socks5':
      return 1080;
  }
}

function proxyConfigToUrl(proxy: ProxyConfig): string {
  const auth =
    proxy.auth?.username
      ? `${encodeURIComponent(proxy.auth.username)}${
          proxy.auth.password ? `:${encodeURIComponent(proxy.auth.password)}` : ''
        }@`
      : '';
  return `${proxy.type}://${auth}${proxy.host}:${proxy.port}`;
}

function matchesNoProxy(target: URL, rules: string[]): boolean {
  const hostname = target.hostname.toLowerCase();
  const port = target.port || defaultPortForProtocol(target.protocol);

  return rules.some((rule) => matchesNoProxyRule(hostname, port, rule));
}

function matchesNoProxyRule(hostname: string, port: string, rawRule: string): boolean {
  const rule = rawRule.trim().toLowerCase();
  if (!rule) return false;
  if (rule === '*') return true;

  const separator = rule.lastIndexOf(':');
  const hasPort = separator > -1 && /^\d+$/.test(rule.slice(separator + 1));
  const ruleHost = hasPort ? rule.slice(0, separator) : rule;
  const rulePort = hasPort ? rule.slice(separator + 1) : '';
  if (rulePort && rulePort !== port) return false;

  const bareHost = ruleHost.replace(/^\*\./, '.');
  if (bareHost.startsWith('.')) {
    const suffix = bareHost.slice(1);
    return hostname === suffix || hostname.endsWith(`.${suffix}`);
  }

  return hostname === bareHost || hostname.endsWith(`.${bareHost}`);
}

function defaultPortForProtocol(protocol: string): string {
  return protocol === 'http:' ? '80' : protocol === 'https:' ? '443' : '';
}

function cloneConfig(config: ProxyConfig | null): ProxyConfig | null {
  if (!config) return null;
  return {
    ...config,
    ...(config.auth ? { auth: { ...config.auth } } : {}),
    ...(config.noProxy ? { noProxy: [...config.noProxy] } : {}),
  };
}
