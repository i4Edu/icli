import { config } from '../config.js';
import { getGlobalAPIServer } from '../server/api-server.js';
import { theme } from '../ui/theme.js';

export interface AcpCommandOptions {
  subcommand?: string;
  args?: string[];
}

export async function acpCommand(options: AcpCommandOptions): Promise<string> {
  const subcommand = (options.subcommand || 'status').toLowerCase();

  switch (subcommand) {
    case 'status':
      return formatAcpStatus();
    case 'enable':
      return await enableAcp(options.args);
    case 'disable':
      return await disableAcp();
    case 'test':
      return await testAcpMethod(options.args);
    case 'help':
      return formatAcpHelp();
    default:
      return `${theme.error('Unknown ACP subcommand:')} ${subcommand}\n\n${formatAcpHelp()}`;
  }
}

function formatAcpStatus(): string {
  const server = getGlobalAPIServer();
  const isRunning = server.isRunning();
  const port = server.getPort();

  if (!isRunning) {
    return theme.info('ACP Server is currently disabled.');
  }

  return `${theme.success('ACP Server is running')}
  ${theme.muted('Protocol:')} Agent Client Protocol (ACP)
  ${theme.muted('Endpoint:')} http://localhost:${port}/acp
  ${theme.muted('Methods:')}
    • tools/list - list available tools
    • tool/call - execute a tool
    • capabilities/get - get server capabilities

  ${theme.muted('Test request:')}
    curl -X POST http://localhost:${port}/acp \\
      -H 'Content-Type: application/json' \\
      -d '{"jsonrpc":"2.0","method":"capabilities/get","id":1}'
`;
}

async function enableAcp(args?: string[]): Promise<string> {
  const portStr = args?.[0];
  const port = portStr ? parseInt(portStr, 10) : 5173;

  if (isNaN(port) || port < 1024 || port > 65535) {
    return theme.error(`Invalid port: ${portStr || 'default'}`);
  }

  try {
    const server = getGlobalAPIServer();
    const actualPort = await server.start(port);

    return `${theme.success('ACP Server enabled')}
  ${theme.muted('Port:')} ${actualPort}
  ${theme.muted('Endpoint:')} http://localhost:${actualPort}/acp

${theme.info('Test with:')}
  curl -X POST http://localhost:${actualPort}/acp \\
    -H 'Content-Type: application/json' \\
    -d '{"jsonrpc":"2.0","method":"capabilities/get","id":1}'
`;
  } catch (error) {
    return theme.error(`Failed to start ACP server: ${error instanceof Error ? error.message : String(error)}`);
  }
}

async function disableAcp(): Promise<string> {
  try {
    const server = getGlobalAPIServer();
    if (!server.isRunning()) {
      return theme.info('ACP Server is already disabled.');
    }

    await server.stop();
    return theme.success('ACP Server disabled');
  } catch (error) {
    return theme.error(`Failed to stop ACP server: ${error instanceof Error ? error.message : String(error)}`);
  }
}

async function testAcpMethod(args?: string[]): Promise<string> {
  const method = args?.[0];
  if (!method) {
    return theme.error('Usage: /acp test <method> [params]');
  }

  const server = getGlobalAPIServer();
  if (!server.isRunning()) {
    return theme.error('ACP Server is not running. Use /acp enable [port] first.');
  }

  const port = server.getPort();
  if (!port) {
    return theme.error('Could not determine ACP server port.');
  }

  const paramsStr = args?.slice(1).join(' ') || '';
  let params: unknown = undefined;
  if (paramsStr) {
    try {
      params = JSON.parse(paramsStr);
    } catch {
      return theme.error(`Invalid JSON params: ${paramsStr}`);
    }
  }

  const request = {
    jsonrpc: '2.0',
    method,
    params,
    id: Math.floor(Math.random() * 1000000),
  };

  return `${theme.info('Test request:')}
${JSON.stringify(request, null, 2)}

${theme.info('Execute with:')}
  curl -X POST http://localhost:${port}/acp \\
    -H 'Content-Type: application/json' \\
    -d '${JSON.stringify(request)}'

${theme.muted('Expected responses:')}
  • tools/list → array of available tools
  • tool/call → requires toolName and args in params
  • capabilities/get → server capabilities and version
`;
}

function formatAcpHelp(): string {
  return `${theme.brand('ACP (Agent Client Protocol) Commands')}

${theme.muted('Usage:')} /acp [command] [options]

${theme.muted('Commands:')}
  status              show ACP server status and configuration
  enable [port]       start ACP server on specified port (default 5173)
  disable             stop the ACP server
  test <method>       test an ACP method with sample request
  help                show this help message

${theme.muted('Examples:')}
  /acp status
  /acp enable 5173
  /acp test tools/list
  /acp test capabilities/get

${theme.muted('ACP allows external agents to:')}
  • List available iCopilot tools
  • Execute iCopilot tools with parameters
  • Query server capabilities and version
`;
}
