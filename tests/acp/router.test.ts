import { describe, it, expect, vi, beforeEach } from 'vitest';
import { AcpRouter } from '../../src/acp/router.js';
import {
  createJsonRpcError,
  createJsonRpcResponse,
  JSON_RPC_ERROR_CODES,
  validateJsonRpcRequest,
} from '../../src/acp/schema.js';

describe('ACP Schema', () => {
  describe('validateJsonRpcRequest', () => {
    it('should validate a valid JSON-RPC 2.0 request', () => {
      const result = validateJsonRpcRequest({
        jsonrpc: '2.0',
        method: 'tools/list',
        id: 1,
      });
      expect(result.valid).toBe(true);
    });

    it('should reject request without jsonrpc field', () => {
      const result = validateJsonRpcRequest({
        method: 'tools/list',
        id: 1,
      });
      expect(result.valid).toBe(false);
      expect(result.error).toContain('jsonrpc');
    });

    it('should reject request with wrong jsonrpc version', () => {
      const result = validateJsonRpcRequest({
        jsonrpc: '1.0',
        method: 'tools/list',
        id: 1,
      });
      expect(result.valid).toBe(false);
    });

    it('should reject request without method', () => {
      const result = validateJsonRpcRequest({
        jsonrpc: '2.0',
        id: 1,
      });
      expect(result.valid).toBe(false);
      expect(result.error).toContain('method');
    });

    it('should reject request with invalid id type', () => {
      const result = validateJsonRpcRequest({
        jsonrpc: '2.0',
        method: 'tools/list',
        id: { foo: 'bar' },
      });
      expect(result.valid).toBe(false);
      expect(result.error).toContain('id');
    });

    it('should accept request with string id', () => {
      const result = validateJsonRpcRequest({
        jsonrpc: '2.0',
        method: 'tools/list',
        id: 'abc123',
      });
      expect(result.valid).toBe(true);
    });

    it('should accept request with null id', () => {
      const result = validateJsonRpcRequest({
        jsonrpc: '2.0',
        method: 'tools/list',
        id: null,
      });
      expect(result.valid).toBe(true);
    });

    it('should accept request without id', () => {
      const result = validateJsonRpcRequest({
        jsonrpc: '2.0',
        method: 'tools/list',
      });
      expect(result.valid).toBe(true);
    });
  });

  describe('createJsonRpcResponse', () => {
    it('should create a success response', () => {
      const response = createJsonRpcResponse({ foo: 'bar' }, 1);
      expect(response.jsonrpc).toBe('2.0');
      expect(response.result).toEqual({ foo: 'bar' });
      expect(response.error).toBeUndefined();
      expect(response.id).toBe(1);
    });
  });

  describe('createJsonRpcError', () => {
    it('should create an error response', () => {
      const response = createJsonRpcError(
        JSON_RPC_ERROR_CODES.METHOD_NOT_FOUND,
        'Method not found',
        undefined,
        1,
      );
      expect(response.jsonrpc).toBe('2.0');
      expect(response.error?.code).toBe(-32601);
      expect(response.error?.message).toBe('Method not found');
      expect(response.result).toBeUndefined();
      expect(response.id).toBe(1);
    });

    it('should include error data if provided', () => {
      const data = { toolName: 'unknown' };
      const response = createJsonRpcError(
        JSON_RPC_ERROR_CODES.METHOD_NOT_FOUND,
        'Tool not found',
        data,
        1,
      );
      expect(response.error?.data).toEqual(data);
    });
  });
});

describe('AcpRouter', () => {
  let router: AcpRouter;
  let logs: Array<{ level: string; message: string; data?: unknown }>;

  beforeEach(() => {
    logs = [];
    router = new AcpRouter({
      onLog: (level, message, data) => {
        logs.push({ level, message, data });
      },
    });
  });

  describe('request validation', () => {
    it('should reject invalid JSON-RPC request', async () => {
      const response = await router.handle({ method: 'tools/list' });
      expect(response.error).toBeDefined();
      expect(response.error?.code).toBe(JSON_RPC_ERROR_CODES.INVALID_REQUEST);
    });

    it('should reject request with invalid method name', async () => {
      const response = await router.handle({
        jsonrpc: '2.0',
        method: 'invalid@method!',
        id: 1,
      });
      expect(response.error).toBeDefined();
      expect(response.error?.code).toBe(JSON_RPC_ERROR_CODES.METHOD_NOT_FOUND);
    });

    it('should reject request with method name too long', async () => {
      const longMethod = 'a'.repeat(200);
      const response = await router.handle({
        jsonrpc: '2.0',
        method: longMethod,
        id: 1,
      });
      expect(response.error).toBeDefined();
      expect(response.error?.code).toBe(JSON_RPC_ERROR_CODES.METHOD_NOT_FOUND);
    });
  });

  describe('tools/list method', () => {
    it('should return list of available tools', async () => {
      const response = await router.handle({
        jsonrpc: '2.0',
        method: 'tools/list',
        id: 1,
      });

      expect(response.error).toBeUndefined();
      expect(Array.isArray(response.result)).toBe(true);
      expect((response.result as Array<unknown>).length).toBeGreaterThan(0);

      const tools = response.result as Array<{
        name: string;
        description: string;
        inputSchema: unknown;
      }>;
      expect(tools[0].name).toBeDefined();
      expect(tools[0].description).toBeDefined();
      expect(tools[0].inputSchema).toBeDefined();
    });

    it('should include tool schemas in response', async () => {
      const response = await router.handle({
        jsonrpc: '2.0',
        method: 'tools/list',
        id: 1,
      });

      const tools = response.result as Array<{ name: string; inputSchema: any }>;
      const toolNames = tools.map((t) => t.name);

      expect(toolNames).toContain('run_shell');
      expect(toolNames).toContain('read_file');
      expect(toolNames).toContain('write_file');
      expect(toolNames).toContain('grep');
      expect(toolNames).toContain('glob');
    });

    it('should include id in response', async () => {
      const response = await router.handle({
        jsonrpc: '2.0',
        method: 'tools/list',
        id: 'test-123',
      });

      expect(response.id).toBe('test-123');
    });
  });

  describe('capabilities/get method', () => {
    it('should return server capabilities', async () => {
      const response = await router.handle({
        jsonrpc: '2.0',
        method: 'capabilities/get',
        id: 1,
      });

      expect(response.error).toBeUndefined();
      expect(response.result).toBeDefined();

      const caps = response.result as {
        version: string;
        protocolVersion: string;
        supportedMethods: string[];
        name: string;
      };
      expect(caps.version).toBeDefined();
      expect(caps.protocolVersion).toBe('1.0');
      expect(Array.isArray(caps.supportedMethods)).toBe(true);
      expect(caps.supportedMethods).toContain('tools/list');
      expect(caps.supportedMethods).toContain('tool/call');
      expect(caps.supportedMethods).toContain('capabilities/get');
      expect(caps.name).toContain('iCopilot');
    });
  });

  describe('tool/call method', () => {
    it('should reject missing toolName', async () => {
      const response = await router.handle({
        jsonrpc: '2.0',
        method: 'tool/call',
        params: {
          args: {},
        },
        id: 1,
      });

      expect(response.error).toBeDefined();
      expect(response.error?.code).toBe(JSON_RPC_ERROR_CODES.INVALID_PARAMS);
      expect(response.error?.message).toContain('toolName');
    });

    it('should reject missing args', async () => {
      const response = await router.handle({
        jsonrpc: '2.0',
        method: 'tool/call',
        params: {
          toolName: 'read_file',
        },
        id: 1,
      });

      expect(response.error).toBeDefined();
      expect(response.error?.code).toBe(JSON_RPC_ERROR_CODES.INVALID_PARAMS);
      expect(response.error?.message).toContain('args');
    });

    it('should reject non-object params', async () => {
      const response = await router.handle({
        jsonrpc: '2.0',
        method: 'tool/call',
        params: 'not an object',
        id: 1,
      });

      expect(response.error).toBeDefined();
      expect(response.error?.code).toBe(JSON_RPC_ERROR_CODES.INVALID_PARAMS);
    });

    it('should reject undefined params', async () => {
      const response = await router.handle({
        jsonrpc: '2.0',
        method: 'tool/call',
        id: 1,
      });

      expect(response.error).toBeDefined();
      expect(response.error?.code).toBe(JSON_RPC_ERROR_CODES.INVALID_PARAMS);
    });
  });

  describe('unknown methods', () => {
    it('should reject unknown namespace', async () => {
      const response = await router.handle({
        jsonrpc: '2.0',
        method: 'unknown/method',
        id: 1,
      });

      expect(response.error).toBeDefined();
      expect(response.error?.code).toBe(JSON_RPC_ERROR_CODES.METHOD_NOT_FOUND);
    });

    it('should reject unknown tools method', async () => {
      const response = await router.handle({
        jsonrpc: '2.0',
        method: 'tools/unknown',
        id: 1,
      });

      expect(response.error).toBeDefined();
      expect(response.error?.code).toBe(JSON_RPC_ERROR_CODES.METHOD_NOT_FOUND);
    });

    it('should reject unknown tool method', async () => {
      const response = await router.handle({
        jsonrpc: '2.0',
        method: 'tool/unknown',
        id: 1,
      });

      expect(response.error).toBeDefined();
      expect(response.error?.code).toBe(JSON_RPC_ERROR_CODES.METHOD_NOT_FOUND);
    });

    it('should reject unknown capabilities method', async () => {
      const response = await router.handle({
        jsonrpc: '2.0',
        method: 'capabilities/unknown',
        id: 1,
      });

      expect(response.error).toBeDefined();
      expect(response.error?.code).toBe(JSON_RPC_ERROR_CODES.METHOD_NOT_FOUND);
    });
  });

  describe('error responses', () => {
    it('should include id in error responses', async () => {
      const response = await router.handle({
        jsonrpc: '2.0',
        method: 'unknown/method',
        id: 'error-test',
      });

      expect(response.id).toBe('error-test');
      expect(response.error).toBeDefined();
    });

    it('should include error code and message', async () => {
      const response = await router.handle({
        jsonrpc: '2.0',
        method: 'unknown/method',
        id: 1,
      });

      expect(response.error?.code).toBeDefined();
      expect(response.error?.message).toBeDefined();
      expect(typeof response.error?.code).toBe('number');
      expect(typeof response.error?.message).toBe('string');
    });
  });

  describe('logging', () => {
    it('should log debug messages for valid requests', async () => {
      logs = [];
      await router.handle({
        jsonrpc: '2.0',
        method: 'capabilities/get',
        id: 1,
      });

      expect(logs.some((l) => l.level === 'debug' && l.message.includes('ACP request'))).toBe(true);
    });

    it('should log warnings for invalid requests', async () => {
      logs = [];
      await router.handle({
        jsonrpc: '2.0',
        method: 'invalid@method!',
        id: 1,
      });

      expect(logs.some((l) => l.level === 'warn')).toBe(true);
    });

    it('should include method name in logs', async () => {
      logs = [];
      await router.handle({
        jsonrpc: '2.0',
        method: 'tools/list',
        id: 1,
      });

      expect(logs.some((l) => l.data?.method === 'tools/list')).toBe(true);
    });
  });

  describe('response format', () => {
    it('should always return jsonrpc 2.0', async () => {
      const response = await router.handle({
        jsonrpc: '2.0',
        method: 'tools/list',
        id: 1,
      });

      expect(response.jsonrpc).toBe('2.0');
    });

    it('should have either result or error, not both', async () => {
      const successResponse = await router.handle({
        jsonrpc: '2.0',
        method: 'capabilities/get',
        id: 1,
      });

      expect((successResponse.result === undefined) === (successResponse.error !== undefined)).toBe(
        true,
      );
    });

    it('should include id when provided', async () => {
      const response = await router.handle({
        jsonrpc: '2.0',
        method: 'tools/list',
        id: 123,
      });

      expect(response.id).toBe(123);
    });

    it('should handle string ids', async () => {
      const response = await router.handle({
        jsonrpc: '2.0',
        method: 'tools/list',
        id: 'abc-123',
      });

      expect(response.id).toBe('abc-123');
    });
  });
});
