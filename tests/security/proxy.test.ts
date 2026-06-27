import fs from 'node:fs';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ProxyManager, type ProxyConfig } from '../../src/security/proxy.js';
import { defaultContext } from '../../src/util/completion.js';

let tmpRoot: string;
let tmpDir: string;
let proxyPath: string;
let originalEnv: Record<string, string | undefined>;

function writeProxyFile(config: ProxyConfig): void {
  fs.mkdirSync(path.dirname(proxyPath), { recursive: true });
  fs.writeFileSync(proxyPath, `${JSON.stringify(config, null, 2)}\n`, 'utf8');
}

beforeEach(() => {
  tmpRoot = path.join(process.cwd(), '.vitest-proxy-tmp');
  fs.mkdirSync(tmpRoot, { recursive: true });
  tmpDir = fs.mkdtempSync(path.join(tmpRoot, 'case-'));
  proxyPath = path.join(tmpDir, '.icopilot', 'proxy.json');
  originalEnv = {
    ICOPILOT_PROXY_PATH: process.env.ICOPILOT_PROXY_PATH,
    HTTP_PROXY: process.env.HTTP_PROXY,
    HTTPS_PROXY: process.env.HTTPS_PROXY,
    NO_PROXY: process.env.NO_PROXY,
    http_proxy: process.env.http_proxy,
    https_proxy: process.env.https_proxy,
    no_proxy: process.env.no_proxy,
  };
  process.env.ICOPILOT_PROXY_PATH = proxyPath;
  delete process.env.HTTP_PROXY;
  delete process.env.HTTPS_PROXY;
  delete process.env.NO_PROXY;
  delete process.env.http_proxy;
  delete process.env.https_proxy;
  delete process.env.no_proxy;
});

afterEach(() => {
  for (const [key, value] of Object.entries(originalEnv)) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
  fs.rmSync(tmpRoot, { recursive: true, force: true });
  ProxyManager.shared().clearProxy();
  vi.clearAllMocks();
});

describe('ProxyManager', () => {
  it('loads persisted proxy config and normalizes proxy URLs', () => {
    const config: ProxyConfig = {
      type: 'http',
      host: 'proxy.local',
      port: 8080,
      auth: { username: 'user', password: 'secret' },
      noProxy: ['localhost', '.internal.example.com'],
    };
    writeProxyFile(config);

    expect(ProxyManager.parseProxyUrl('socks5://alice:pass@proxy.example:1080')).toEqual({
      type: 'socks5',
      host: 'proxy.example',
      port: 1080,
      auth: { username: 'alice', password: 'pass' },
    });

    const manager = new ProxyManager();
    expect(manager.loadConfig()).toEqual(config);
    expect(manager.getSource()).toBe('file');
  });

  it('prefers env proxy settings over file config and applies NO_PROXY', () => {
    writeProxyFile({ type: 'http', host: 'file-proxy.local', port: 8080 });
    process.env.HTTPS_PROXY = 'https://env-proxy.local:8443';
    process.env.NO_PROXY = 'localhost,.internal.example.com,api.example.com:8443';

    const manager = new ProxyManager();
    expect(manager.loadConfig()).toEqual({
      type: 'https',
      host: 'env-proxy.local',
      port: 8443,
      noProxy: ['localhost', '.internal.example.com', 'api.example.com:8443'],
    });
    expect(manager.getSource()).toBe('env');
  });

  it('persists updates, clears config, and honors no_proxy bypass rules', () => {
    const manager = new ProxyManager();
    manager.setProxy({
      type: 'http',
      host: 'proxy.local',
      port: 8080,
      noProxy: ['localhost', '.internal.example.com', 'api.example.com:8443'],
    });

    expect(fs.existsSync(proxyPath)).toBe(true);
    expect(manager.isProxied('https://example.com')).toBe(true);
    expect(manager.isProxied('http://localhost:3000')).toBe(false);
    expect(manager.isProxied('https://service.internal.example.com')).toBe(false);
    expect(manager.isProxied('https://api.example.com:8443')).toBe(false);
    expect(manager.isProxied('https://api.example.com:443')).toBe(true);

    manager.clearProxy();
    expect(fs.existsSync(proxyPath)).toBe(false);
    expect(manager.loadConfig()).toBeNull();
  });
});

describe('proxy slash integration', () => {
  it('adds proxy to shell completion', () => {
    expect(defaultContext(tmpDir).slashCommands).toContain('proxy');
  });

  it('wires proxy into slash command handling', async () => {
    const slashSource = fs.readFileSync(path.join(process.cwd(), 'src', 'commands', 'slash.ts'), 'utf8');
    expect(slashSource).toContain("case 'proxy':");
    expect(slashSource).toContain("/proxy [show|set <url>|clear|test");
  });
});
