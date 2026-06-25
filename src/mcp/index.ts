import type { ChatCompletionTool } from 'openai/resources/chat/completions';
import { config } from '../config.js';
import { McpClient, type McpTool } from './client.js';
import { loadMcpConfigs } from './config.js';

const clients = new Map<string, McpClient>();
const toolRoutes = new Map<string, { server: string; tool: string }>();
let loaded = false;

export async function loadMcpServers(): Promise<void> {
  if (loaded) return;
  loaded = true;
  try {
    const file = loadMcpConfigs(config.cwd);
    await Promise.all(
      Object.entries(file.servers).map(async ([name, serverConfig]) => {
        try {
          const client = new McpClient(name, serverConfig);
          await client.start();
          clients.set(name, client);
        } catch (e: any) {
          process.stderr.write(`[MCP/${name}] disabled: ${e?.message || e}\n`);
        }
      }),
    );
  } catch (e: any) {
    process.stderr.write(`[MCP] load failed: ${e?.message || e}\n`);
  }
}

export async function getMcpTools(): Promise<{
  schemas: ChatCompletionTool[];
  dispatch: (name: string, args: any) => Promise<string>;
}> {
  try {
    await loadMcpServers();
    const schemas: ChatCompletionTool[] = [];
    toolRoutes.clear();

    await Promise.all(
      [...clients.entries()].map(async ([server, client]) => {
        try {
          const tools = await client.listTools();
          for (const tool of tools) {
            const functionName = namespacedToolName(server, tool.name);
            toolRoutes.set(functionName, { server, tool: tool.name });
            schemas.push(toChatTool(functionName, server, tool));
          }
        } catch (e: any) {
          process.stderr.write(`[MCP/${server}] tools/list failed: ${e?.message || e}\n`);
        }
      }),
    );

    return { schemas, dispatch };
  } catch (e: any) {
    process.stderr.write(`[MCP] tools unavailable: ${e?.message || e}\n`);
    return { schemas: [], dispatch };
  }
}

export async function shutdownMcp(): Promise<void> {
  for (const client of clients.values()) client.stop();
  clients.clear();
  toolRoutes.clear();
  loaded = false;
}

async function dispatch(name: string, args: any): Promise<string> {
  const route = toolRoutes.get(name);
  if (!route) return JSON.stringify({ error: `unknown MCP tool: ${name}` });
  const client = clients.get(route.server);
  if (!client) return JSON.stringify({ error: `MCP server not loaded: ${route.server}` });
  try {
    return await client.callTool(route.tool, args);
  } catch (e: any) {
    return JSON.stringify({ error: e?.message || String(e) });
  }
}

function toChatTool(name: string, server: string, tool: McpTool): ChatCompletionTool {
  return {
    type: 'function',
    function: {
      name,
      description: `[MCP/${server}] ${tool.description || tool.name}`,
      parameters: (tool.inputSchema as any) || { type: 'object', properties: {} },
    },
  };
}

function namespacedToolName(server: string, tool: string): string {
  return `mcp__${safeName(server)}__${safeName(tool)}`;
}

function safeName(name: string): string {
  return name.replace(/[^a-zA-Z0-9_-]/g, '_');
}
