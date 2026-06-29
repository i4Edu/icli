export interface AcpError {
  code: number;
  message: string;
  data?: unknown;
}

export interface AcpRequest {
  jsonrpc: '2.0';
  method: string;
  params?: unknown;
  id?: string | number | null;
}

export interface AcpResponse<T = unknown> {
  jsonrpc: '2.0';
  result?: T;
  error?: AcpError;
  id?: string | number | null;
}

export interface AcpToolInputSchema {
  type: 'object';
  properties: Record<string, unknown>;
  required?: string[];
}

export interface AcpTool {
  name: string;
  description?: string;
  inputSchema: AcpToolInputSchema;
}

export interface AcpCapabilities {
  version: string;
  protocolVersion: '1.0';
  supportedMethods: string[];
  name: string;
}

export const JSON_RPC_ERROR_CODES = {
  PARSE_ERROR: -32700,
  INVALID_REQUEST: -32600,
  METHOD_NOT_FOUND: -32601,
  INVALID_PARAMS: -32602,
  INTERNAL_ERROR: -32603,
  SERVER_ERROR_START: -32099,
  SERVER_ERROR_END: -32000,
  NOT_AUTHORIZED: -32001,
} as const;

export function validateJsonRpcRequest(data: unknown): { valid: boolean; error?: string } {
  if (typeof data !== 'object' || data === null) {
    return { valid: false, error: 'Request must be an object' };
  }

  const req = data as Record<string, unknown>;

  if (req.jsonrpc !== '2.0') {
    return { valid: false, error: 'jsonrpc must be "2.0"' };
  }

  if (typeof req.method !== 'string' || !req.method) {
    return { valid: false, error: 'method must be a non-empty string' };
  }

  if (
    req.id !== undefined &&
    typeof req.id !== 'string' &&
    typeof req.id !== 'number' &&
    req.id !== null
  ) {
    return { valid: false, error: 'id must be a string, number, or null' };
  }

  return { valid: true };
}

export function createJsonRpcResponse<T>(result: T, id?: string | number | null): AcpResponse<T> {
  return {
    jsonrpc: '2.0',
    result,
    id,
  };
}

export function createJsonRpcError(
  code: number,
  message: string,
  data?: unknown,
  id?: string | number | null,
): AcpResponse {
  return {
    jsonrpc: '2.0',
    error: { code, message, data },
    id,
  };
}

export function isValidMethodName(method: string): boolean {
  return /^[a-zA-Z0-9_/-]+$/.test(method) && method.length > 0 && method.length <= 128;
}

export function parseMethodNamespace(method: string): { namespace: string; action: string } {
  const parts = method.split('/');
  if (parts.length === 2) {
    return { namespace: parts[0], action: parts[1] };
  }
  return { namespace: '', action: method };
}
