import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

export interface McpServerConfig {
  command: string;
  args?: string[];
  env?: Record<string, string>;
  cwd?: string;
}

export interface McpFile {
  servers: Record<string, McpServerConfig>;
}

export function loadMcpConfigs(cwd: string): McpFile {
  const user = readConfig(path.join(os.homedir(), '.icopilot', 'mcp.json'));
  const project = readConfig(path.join(cwd, '.mcp.json'));
  return {
    servers: {
      ...user.servers,
      ...project.servers,
    },
  };
}

function readConfig(file: string): McpFile {
  try {
    if (!fs.existsSync(file)) return { servers: {} };
    const parsed = JSON.parse(fs.readFileSync(file, 'utf8')) as Partial<McpFile>;
    return { servers: parsed.servers && typeof parsed.servers === 'object' ? parsed.servers : {} };
  } catch {
    return { servers: {} };
  }
}
