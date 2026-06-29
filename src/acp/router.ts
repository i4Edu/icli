import { TOOL_SCHEMAS, dispatchTool } from '../tools/registry.js';
import {
  type AcpCapabilities,
  type AcpRequest,
  type AcpResponse,
  type AcpTool,
  JSON_RPC_ERROR_CODES,
  createJsonRpcError,
  createJsonRpcResponse,
  isValidMethodName,
  parseMethodNamespace,
  validateJsonRpcRequest,
} from './schema.js';

const VERSION = '2.2.0';

export interface AcpRouterOptions {
  version?: string;
  onLog?: (level: 'debug' | 'info' | 'warn' | 'error', message: string, data?: unknown) => void;
}

export class AcpRouter {
  private version: string;
  private onLog: (
    level: 'debug' | 'info' | 'warn' | 'error',
    message: string,
    data?: unknown,
  ) => void;

  constructor(options?: AcpRouterOptions) {
    this.version = options?.version ?? VERSION;
    this.onLog = options?.onLog ?? (() => {});
  }

  async handle(request: unknown): Promise<AcpResponse> {
    const validation = validateJsonRpcRequest(request);
    if (!validation.valid) {
      this.onLog('warn', 'Invalid JSON-RPC request', validation.error);
      return createJsonRpcError(
        JSON_RPC_ERROR_CODES.INVALID_REQUEST,
        validation.error ?? 'Invalid request',
      );
    }

    const req = request as AcpRequest;

    if (!isValidMethodName(req.method)) {
      this.onLog('warn', 'Invalid method name', { method: req.method });
      return createJsonRpcError(
        JSON_RPC_ERROR_CODES.METHOD_NOT_FOUND,
        'Invalid method name',
        undefined,
        req.id,
      );
    }

    this.onLog('debug', 'ACP request', { method: req.method, id: req.id });

    try {
      const { namespace, action } = parseMethodNamespace(req.method);

      switch (namespace) {
        case 'tools':
          return await this.handleToolsMethod(action, req);
        case 'tool':
          return await this.handleToolMethod(action, req);
        case 'capabilities':
          return await this.handleCapabilitiesMethod(action, req);
        default:
          this.onLog('warn', 'Unknown method namespace', { namespace, method: req.method });
          return createJsonRpcError(
            JSON_RPC_ERROR_CODES.METHOD_NOT_FOUND,
            `Unknown method: ${req.method}`,
            undefined,
            req.id,
          );
      }
    } catch (error) {
      this.onLog('error', 'Error handling ACP request', {
        method: req.method,
        error: error instanceof Error ? error.message : String(error),
      });
      return createJsonRpcError(
        JSON_RPC_ERROR_CODES.INTERNAL_ERROR,
        error instanceof Error ? error.message : 'Internal server error',
        undefined,
        req.id,
      );
    }
  }

  private async handleToolsMethod(action: string, req: AcpRequest): Promise<AcpResponse> {
    if (action === 'list') {
      const tools = this.getAvailableTools();
      this.onLog('debug', 'Listed tools', { count: tools.length });
      return createJsonRpcResponse(tools, req.id);
    }

    this.onLog('warn', 'Unknown tools method', { action });
    return createJsonRpcError(
      JSON_RPC_ERROR_CODES.METHOD_NOT_FOUND,
      `Unknown method: tools/${action}`,
      undefined,
      req.id,
    );
  }

  private async handleToolMethod(action: string, req: AcpRequest): Promise<AcpResponse> {
    if (action === 'call') {
      return await this.callTool(req);
    }

    this.onLog('warn', 'Unknown tool method', { action });
    return createJsonRpcError(
      JSON_RPC_ERROR_CODES.METHOD_NOT_FOUND,
      `Unknown method: tool/${action}`,
      undefined,
      req.id,
    );
  }

  private async handleCapabilitiesMethod(action: string, req: AcpRequest): Promise<AcpResponse> {
    if (action === 'get') {
      const capabilities = this.getCapabilities();
      this.onLog('debug', 'Retrieved capabilities', {
        version: capabilities.version,
        methods: capabilities.supportedMethods.length,
      });
      return createJsonRpcResponse(capabilities, req.id);
    }

    this.onLog('warn', 'Unknown capabilities method', { action });
    return createJsonRpcError(
      JSON_RPC_ERROR_CODES.METHOD_NOT_FOUND,
      `Unknown method: capabilities/${action}`,
      undefined,
      req.id,
    );
  }

  private getAvailableTools(): AcpTool[] {
    return TOOL_SCHEMAS.filter((tool) => tool.type === 'function').map((tool) => {
      const func = tool.function;
      return {
        name: func.name,
        description: func.description,
        inputSchema: {
          type: 'object',
          properties: (func.parameters as any)?.properties ?? {},
          required: (func.parameters as any)?.required ?? [],
        },
      };
    });
  }

  private async callTool(req: AcpRequest): Promise<AcpResponse> {
    const params = req.params as Record<string, unknown> | undefined;

    if (!params || typeof params !== 'object') {
      this.onLog('warn', 'Invalid tool call params', { id: req.id });
      return createJsonRpcError(
        JSON_RPC_ERROR_CODES.INVALID_PARAMS,
        'params must be an object with toolName and args',
        undefined,
        req.id,
      );
    }

    const toolName = params.toolName as string | undefined;
    const toolArgs = params.args as Record<string, unknown> | undefined;

    if (typeof toolName !== 'string' || !toolName) {
      this.onLog('warn', 'Missing or invalid toolName', { id: req.id });
      return createJsonRpcError(
        JSON_RPC_ERROR_CODES.INVALID_PARAMS,
        'toolName must be a non-empty string',
        undefined,
        req.id,
      );
    }

    if (!toolArgs || typeof toolArgs !== 'object') {
      this.onLog('warn', 'Missing or invalid tool args', { toolName, id: req.id });
      return createJsonRpcError(
        JSON_RPC_ERROR_CODES.INVALID_PARAMS,
        'args must be an object',
        undefined,
        req.id,
      );
    }

    this.onLog('debug', 'Calling tool', { toolName, id: req.id });

    try {
      const result = await dispatchTool(toolName, toolArgs);
      this.onLog('debug', 'Tool call succeeded', { toolName });
      return createJsonRpcResponse({ toolName, result }, req.id);
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : String(error);
      this.onLog('warn', 'Tool call failed', { toolName, error: errorMsg });
      return createJsonRpcError(
        JSON_RPC_ERROR_CODES.INTERNAL_ERROR,
        `Tool execution failed: ${errorMsg}`,
        { toolName, error: errorMsg },
        req.id,
      );
    }
  }

  private getCapabilities(): AcpCapabilities {
    return {
      version: this.version,
      protocolVersion: '1.0',
      supportedMethods: ['tools/list', 'tool/call', 'capabilities/get'],
      name: 'iCopilot ACP Server',
    };
  }
}
