import type { ChatCompletionTool } from 'openai/resources/chat/completions';
import { proposeAndRun } from './shell.js';
import { proposeWrite, proposeWriteBatch, readFileSafe } from './file-ops.js';
import { applyPatchTool } from './apply-patch.js';
import { grepTool } from './grep.js';
import { globTool } from './glob.js';
import { webFetchTool, WEB_FETCH_SCHEMA } from './web.js';

type McpTools = {
  schemas: ChatCompletionTool[];
  dispatch: (name: string, args: any) => Promise<string>;
};

type McpModule = {
  getMcpTools: () => Promise<McpTools>;
  loadMcpServers: () => Promise<void>;
};

const dynamicImport = new Function('specifier', 'return import(specifier)') as (
  specifier: string,
) => Promise<McpModule>;
const mcpModulePromise = dynamicImport('../mcp/index.js').catch(() => null as McpModule | null);
let mcpLoaded = false;
let mcpTools: McpTools | null = null;

export const TOOL_SCHEMAS: ChatCompletionTool[] = [
  {
    type: 'function',
    function: {
      name: 'run_shell',
      description:
        'Propose a shell command to the user. The user MUST approve before it executes. Returns stdout/stderr/exitCode.',
      parameters: {
        type: 'object',
        properties: {
          command: { type: 'string', description: 'Exact command line to run.' },
          explain: {
            type: 'string',
            description: 'One-sentence rationale shown to the user.',
          },
        },
        required: ['command'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'read_file',
      description: 'Read a file from the working directory.',
      parameters: {
        type: 'object',
        properties: { path: { type: 'string' } },
        required: ['path'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'write_file',
      description: 'Propose creating or overwriting a file. User must approve via diff preview.',
      parameters: {
        type: 'object',
        properties: {
          path: { type: 'string' },
          content: { type: 'string' },
        },
        required: ['path', 'content'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'write_files',
      description:
        'Propose creating or overwriting multiple files atomically. User approves one combined diff preview.',
      parameters: {
        type: 'object',
        properties: {
          items: {
            type: 'array',
            items: {
              type: 'object',
              properties: {
                path: { type: 'string' },
                content: { type: 'string' },
              },
              required: ['path', 'content'],
            },
          },
        },
        required: ['items'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'apply_patch',
      description: 'Apply a unified diff patch with interactive hunk-level selection.',
      parameters: {
        type: 'object',
        properties: { patch: { type: 'string' } },
        required: ['patch'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'grep',
      description: 'Read-only repository grep. Returns matching file, line, and text snippets.',
      parameters: {
        type: 'object',
        properties: {
          pattern: { type: 'string' },
          path: { type: 'string' },
          regex: { type: 'boolean' },
          ignoreCase: { type: 'boolean' },
          maxResults: { type: 'number', default: 200 },
        },
        required: ['pattern'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'glob',
      description: 'Read-only repository file glob.',
      parameters: {
        type: 'object',
        properties: {
          pattern: { type: 'string' },
          cwd: { type: 'string' },
          ignore: { type: 'array', items: { type: 'string' } },
        },
        required: ['pattern'],
      },
    },
  },
  WEB_FETCH_SCHEMA,
];

export async function getAllToolSchemas(): Promise<ChatCompletionTool[]> {
  const mcp = await getMcpToolsSafe();
  if (!mcp) return TOOL_SCHEMAS;
  const seen = new Set(TOOL_SCHEMAS.map((schema) => schema.function.name));
  return [...TOOL_SCHEMAS, ...mcp.schemas.filter((schema) => !seen.has(schema.function.name))];
}

export async function dispatchTool(name: string, args: Record<string, any>): Promise<string> {
  const builtIn = await dispatchBuiltIn(name, args);
  if (builtIn !== undefined) return builtIn;
  const mcp = await getMcpToolsSafe();
  if (mcp) return mcp.dispatch(name, args);
  return JSON.stringify({ error: `unknown tool: ${name}` });
}

async function dispatchBuiltIn(
  name: string,
  args: Record<string, any>,
): Promise<string | undefined> {
  switch (name) {
    case 'run_shell': {
      const r = await proposeAndRun(String(args.command || ''), {
        explain: args.explain ? String(args.explain) : undefined,
      });
      return JSON.stringify({
        ran: r.ran,
        exitCode: r.exitCode,
        stdout: truncate(r.stdout, 8000),
        stderr: truncate(r.stderr, 4000),
      });
    }
    case 'read_file': {
      try {
        const c = readFileSafe(String(args.path));
        return JSON.stringify({ ok: true, content: truncate(c, 64_000) });
      } catch (e: any) {
        return JSON.stringify({ ok: false, error: e?.message || String(e) });
      }
    }
    case 'write_file': {
      const r = await proposeWrite(String(args.path), String(args.content ?? ''));
      return JSON.stringify({ wrote: r.wrote, bytes: r.bytes, error: r.error });
    }
    case 'write_files': {
      const items = Array.isArray(args.items) ? args.items : [];
      const r = await proposeWriteBatch(
        items.map((item: any) => ({
          path: String(item.path),
          content: String(item.content ?? ''),
        })),
      );
      return JSON.stringify(r);
    }
    case 'apply_patch':
      return applyPatchTool({ patch: String(args.patch || '') });
    case 'grep':
      return grepTool({
        pattern: String(args.pattern || ''),
        path: args.path ? String(args.path) : undefined,
        regex: Boolean(args.regex),
        ignoreCase: Boolean(args.ignoreCase),
        maxResults: args.maxResults ? Number(args.maxResults) : undefined,
      });
    case 'glob':
      return globTool({
        pattern: String(args.pattern || ''),
        cwd: args.cwd ? String(args.cwd) : undefined,
        ignore: Array.isArray(args.ignore) ? args.ignore.map(String) : undefined,
      });
    case 'web_fetch':
      return webFetchTool(args as any);
    default:
      return undefined;
  }
}

async function getMcpToolsSafe(): Promise<McpTools | null> {
  if (mcpTools) return mcpTools;
  const mod = await mcpModulePromise;
  if (!mod) return null;
  try {
    if (!mcpLoaded) {
      await mod.loadMcpServers();
      mcpLoaded = true;
    }
    mcpTools = await mod.getMcpTools();
    return mcpTools;
  } catch {
    return null;
  }
}

function truncate(s: string, n: number): string {
  return s.length > n ? s.slice(0, n) + `\n…[truncated ${s.length - n} chars]` : s;
}
