import type { ChatCompletionTool } from 'openai/resources/chat/completions';
import { config } from '../config.js';
import { proposeAndRun } from './shell.js';
import { proposeWrite, proposeWriteBatch, readFileSafe } from './file-ops.js';
import { editFileTool, EDIT_FILE_SCHEMA } from './edit-file.js';
import { multiEditSchema, multiEditTool } from './multi-edit.js';
import { applyPatchTool } from './apply-patch.js';
import { grepTool } from './grep.js';
import { globTool } from './glob.js';
import { readImage, DESCRIBE_IMAGE_SCHEMA } from './image.js';
import { listDirectory, listDirectorySchema } from './list-directory.js';
import { searchSymbols, searchSymbolsSchema, type SearchSymbolFilter } from './search-symbols.js';
import { runInTerminal, runInTerminalSchema } from './run-in-terminal.js';
import { withRetry } from './retry.js';
import { webFetchTool, WEB_FETCH_SCHEMA } from './web.js';
import {
  browserFetch,
  browserScreenshot,
  BROWSER_FETCH_SCHEMA,
  BROWSER_SCREENSHOT_SCHEMA,
} from './browser.js';
import {
  githubSearch,
  githubGetRepo,
  GITHUB_SEARCH_SCHEMA,
  GITHUB_GET_REPO_SCHEMA,
} from './github-search.js';
import { AuditLogger, type AuditResult } from '../security/audit.js';
import { RoleManager, defaultRolesConfigPath } from '../security/roles.js';
import { hookManager } from '../hooks/lifecycle.js';

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
const auditLogger = new AuditLogger();

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
  EDIT_FILE_SCHEMA,
  multiEditSchema,
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
  searchSymbolsSchema,
  listDirectorySchema,
  runInTerminalSchema,
  WEB_FETCH_SCHEMA,
  BROWSER_FETCH_SCHEMA,
  BROWSER_SCREENSHOT_SCHEMA,
  GITHUB_SEARCH_SCHEMA,
  GITHUB_GET_REPO_SCHEMA,
  DESCRIBE_IMAGE_SCHEMA,
];

export async function getAllToolSchemas(): Promise<ChatCompletionTool[]> {
  const roleManager = createRoleManager();
  const mcp = await getMcpToolsSafe();
  if (!mcp)
    return TOOL_SCHEMAS.filter((schema) => roleManager.checkAccess(schema.function.name).allowed);
  const seen = new Set(TOOL_SCHEMAS.map((schema) => schema.function.name));
  return [
    ...TOOL_SCHEMAS,
    ...mcp.schemas.filter((schema) => !seen.has(schema.function.name)),
  ].filter((schema) => roleManager.checkAccess(schema.function.name).allowed);
}

export async function dispatchTool(name: string, args: Record<string, any>): Promise<string> {
  const startedAt = Date.now();
  const access = createRoleManager().checkAccess(name);
  if (!access.allowed) {
    const denied = JSON.stringify({ error: access.reason || `access denied: ${name}` });
    recordAudit(name, args, denied, Date.now() - startedAt, 'denied');
    return denied;
  }
  const preToolHook = await hookManager.emit('preToolUse', {
    tool: name,
    args,
    cwd: config.cwd,
  });
  if (preToolHook.action === 'deny') {
    const denied = JSON.stringify({ error: preToolHook.reason || `tool blocked by hook: ${name}` });
    recordAudit(name, args, denied, Date.now() - startedAt, 'denied');
    return denied;
  }
  const effectiveArgs =
    preToolHook.action === 'modify' && preToolHook.modifications
      ? { ...args, ...coerceHookObject(preToolHook.modifications) }
      : args;
  try {
    const builtIn = await withRetry(() => dispatchBuiltIn(name, effectiveArgs));
    if (builtIn !== undefined) {
      const hookedOutput = await applyPostToolHook(name, effectiveArgs, builtIn, startedAt);
      recordAudit(name, effectiveArgs, hookedOutput, Date.now() - startedAt);
      return hookedOutput;
    }
    const mcp = await getMcpToolsSafe();
    if (mcp) {
      const out = await mcp.dispatch(name, effectiveArgs);
      const hookedOutput = await applyPostToolHook(name, effectiveArgs, out, startedAt);
      recordAudit(name, effectiveArgs, hookedOutput, Date.now() - startedAt);
      return hookedOutput;
    }
    const out = JSON.stringify({ error: `unknown tool: ${name}` });
    const hookedOutput = await applyPostToolHook(name, effectiveArgs, out, startedAt);
    recordAudit(name, effectiveArgs, hookedOutput, Date.now() - startedAt, 'failure');
    return hookedOutput;
  } catch (error: unknown) {
    auditLogger.log({
      action: 'tool.execute',
      tool: name,
      command: extractCommand(name, effectiveArgs),
      args: effectiveArgs,
      result: 'failure',
      duration: Date.now() - startedAt,
      details: formatErrorMessage(error),
    });
    await hookManager.emit('errorOccurred', {
      scope: 'tool',
      tool: name,
      args: effectiveArgs,
      cwd: config.cwd,
      message: formatErrorMessage(error),
    });
    throw error;
  }
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
    case 'edit_file':
      return editFileTool({
        path: String(args.path || ''),
        startLine: Number(args.startLine),
        endLine: Number(args.endLine),
        newContent: String(args.newContent ?? ''),
      });
    case 'multi_edit':
      return multiEditTool({
        description: String(args.description ?? ''),
        rollbackable: Boolean(args.rollbackable),
        files: Array.isArray(args.files)
          ? args.files.map((file: any) => ({
              file: String(file.file ?? ''),
              edits: Array.isArray(file.edits)
                ? file.edits.map((edit: any) => ({
                    oldText: String(edit.oldText ?? ''),
                    newText: String(edit.newText ?? ''),
                  }))
                : [],
            }))
          : [],
      });
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
    case 'list_directory':
      return listDirectory({
        path: String(args.path || '.'),
        recursive: Boolean(args.recursive),
        maxDepth: args.maxDepth !== undefined ? Number(args.maxDepth) : undefined,
        pattern: args.pattern ? String(args.pattern) : undefined,
      });
    case 'search_symbols':
      return searchSymbols({
        query: String(args.query || ''),
        filePattern: args.filePattern ? String(args.filePattern) : undefined,
        type: normalizeSearchSymbolType(args.type),
      });
    case 'run_in_terminal':
      return JSON.stringify(
        await runInTerminal({
          command: String(args.command || ''),
          cwd: args.cwd ? String(args.cwd) : undefined,
          timeout: args.timeout === undefined ? undefined : Number(args.timeout),
          env:
            args.env && typeof args.env === 'object'
              ? Object.fromEntries(
                  Object.entries(args.env).map(([key, value]) => [key, String(value)]),
                )
              : undefined,
        }),
      );
    case 'web_fetch':
      return webFetchTool(args as any);
    case 'browser_fetch':
      return browserFetch(args as any);
    case 'browser_screenshot':
      return browserScreenshot(args as any);
    case 'github_search':
      return githubSearch(args as any);
    case 'github_get_repo':
      return githubGetRepo(args as any);
    case 'describe_image':
      return JSON.stringify(readImage(args as any));
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

function normalizeSearchSymbolType(value: unknown): SearchSymbolFilter | undefined {
  return value === 'function' ||
    value === 'class' ||
    value === 'variable' ||
    value === 'interface' ||
    value === 'type' ||
    value === 'all'
    ? value
    : undefined;
}

function createRoleManager(): RoleManager {
  const roleManager = new RoleManager(defaultRolesConfigPath(config.cwd));
  roleManager.loadRoles();
  return roleManager;
}

function recordAudit(
  name: string,
  args: Record<string, any>,
  output: string,
  duration: number,
  forcedResult?: AuditResult,
): void {
  const details = summarizeOutput(output);
  auditLogger.log({
    action: 'tool.execute',
    tool: name,
    command: extractCommand(name, args),
    args,
    result: forcedResult ?? inferAuditResult(name, output),
    duration,
    details: details || undefined,
  });
}

function inferAuditResult(name: string, output: string): AuditResult {
  const parsed = tryParseJson(output);

  if (name === 'run_shell') {
    if (parsed && typeof parsed.ran === 'boolean') {
      if (!parsed.ran) return 'denied';
      return parsed.exitCode === 0 ? 'success' : 'failure';
    }
    return classifyTextResult(output);
  }

  if (name === 'run_in_terminal') {
    if (parsed && typeof parsed.exitCode === 'number') {
      return parsed.exitCode === 0 ? 'success' : 'failure';
    }
    return classifyTextResult(output);
  }

  if (parsed && typeof parsed.wrote === 'boolean') {
    return parsed.wrote ? 'success' : classifyFromPayload(parsed.error);
  }

  if (parsed && typeof parsed.ok === 'boolean') {
    return parsed.ok ? 'success' : classifyFromPayload(parsed.error);
  }

  if (parsed && typeof parsed.success === 'boolean') {
    if (parsed.success) return 'success';
    const failures = Array.isArray(parsed.failed)
      ? parsed.failed
          .map((item: any) => (typeof item?.error === 'string' ? item.error : ''))
          .filter((message: string) => message.length > 0)
      : [];
    if (failures.length > 0) {
      return failures.every((message: string) => isDeniedMessage(message)) ? 'denied' : 'failure';
    }
    return 'failure';
  }

  if (
    parsed &&
    Array.isArray(parsed.applied) &&
    Array.isArray(parsed.skipped) &&
    Array.isArray(parsed.errors)
  ) {
    if (parsed.errors.length > 0) return 'failure';
    if (parsed.applied.length > 0) return 'success';
    if (parsed.skipped.length > 0) return 'denied';
  }

  if (parsed && typeof parsed.error === 'string') {
    return classifyFromPayload(parsed.error);
  }

  return classifyTextResult(output);
}

function classifyFromPayload(message: unknown): AuditResult {
  return typeof message === 'string' && isDeniedMessage(message) ? 'denied' : 'failure';
}

function classifyTextResult(text: string): AuditResult {
  if (!text.trim()) return 'success';
  const parsed = tryParseJson(text);
  if (parsed && typeof parsed.error === 'string') {
    return classifyFromPayload(parsed.error);
  }
  return /"error"\s*:/u.test(text) ? 'failure' : 'success';
}

function isDeniedMessage(message: string): boolean {
  return /\b(denied|blocked|cancelled|canceled|rejected|skipped|not selected)\b/iu.test(message);
}

function summarizeOutput(output: string): string {
  const trimmed = output.trim();
  if (!trimmed) return '';
  return trimmed.length > 400
    ? `${trimmed.slice(0, 400)}…[truncated ${trimmed.length - 400} chars]`
    : trimmed;
}

function extractCommand(name: string, args: Record<string, any>): string | undefined {
  if (name === 'run_shell' || name === 'run_in_terminal') {
    return typeof args.command === 'string' && args.command.trim().length > 0
      ? args.command.trim()
      : undefined;
  }
  return undefined;
}

function tryParseJson(value: string): any {
  try {
    return JSON.parse(value);
  } catch {
    return null;
  }
}

function formatErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

async function applyPostToolHook(
  name: string,
  args: Record<string, any>,
  output: string,
  startedAt: number,
): Promise<string> {
  const hookResult = await hookManager.emit('postToolUse', {
    tool: name,
    args,
    output,
    cwd: config.cwd,
    duration: Date.now() - startedAt,
  });
  if (hookResult.action !== 'modify' || !hookResult.modifications) return output;
  const modifications = coerceHookObject(hookResult.modifications);
  if (typeof modifications.output === 'string') return modifications.output;
  if (modifications.result && typeof modifications.result === 'object') {
    return JSON.stringify(modifications.result);
  }
  return output;
}

function coerceHookObject(value: object): Record<string, any> {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, any>)
    : {};
}
