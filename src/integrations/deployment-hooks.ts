import fs from 'node:fs';
import path from 'node:path';
import { config } from '../config.js';
import { theme } from '../ui/theme.js';

export interface DeploymentContext {
  environment: string;
  version: string;
  commitSha: string;
  branch: string;
  timestamp: number;
  metadata?: Record<string, string | number | boolean>;
}

export interface DeploymentHook {
  name: string;
  trigger: 'pre-deploy' | 'post-deploy' | 'rollback';
  action:
    | string
    | ((
        event: DeploymentEvent,
      ) => string | Record<string, unknown> | Promise<string | Record<string, unknown>>);
}

export interface DeploymentHookResult {
  name: string;
  success: boolean;
  output?: string;
  details?: Record<string, unknown>;
  error?: string;
}

export interface DeploymentEvent {
  type: 'pre-deploy' | 'post-deploy' | 'rollback';
  context: DeploymentContext;
  sessionId?: string;
  hookResults?: DeploymentHookResult[];
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function configPath(cwd: string): string {
  return path.join(cwd, '.icopilot', 'deployment-hooks.json');
}

function cloneContext(context: DeploymentContext): DeploymentContext {
  return {
    ...context,
    metadata: context.metadata ? { ...context.metadata } : undefined,
  };
}

function cloneHook(hook: DeploymentHook): DeploymentHook {
  return { ...hook };
}

function isDeploymentHook(value: unknown): value is DeploymentHook {
  return (
    isRecord(value) &&
    typeof value.name === 'string' &&
    (value.trigger === 'pre-deploy' ||
      value.trigger === 'post-deploy' ||
      value.trigger === 'rollback') &&
    (typeof value.action === 'string' || typeof value.action === 'function')
  );
}

function normalizeHookResult(name: string, value: unknown): DeploymentHookResult {
  if (typeof value === 'string') {
    return { name, success: true, output: value };
  }
  if (isRecord(value)) {
    return {
      name,
      success: true,
      output: typeof value.message === 'string' ? value.message : undefined,
      details: { ...value },
    };
  }
  return { name, success: true };
}

export class DeploymentHookManager {
  private readonly hooks = new Map<string, DeploymentHook>();
  private readonly sessionContexts = new Map<string, DeploymentContext>();

  registerHook(hook: DeploymentHook): void {
    this.hooks.set(hook.name, cloneHook(hook));
  }

  async triggerHooks(event: DeploymentEvent): Promise<DeploymentEvent> {
    const attachedContext = event.sessionId ? this.sessionContexts.get(event.sessionId) : undefined;
    const activeEvent: DeploymentEvent = {
      ...event,
      context: attachedContext ? cloneContext(attachedContext) : cloneContext(event.context),
      hookResults: [],
    };

    const matchingHooks = [...this.hooks.values()].filter((hook) => hook.trigger === event.type);
    for (const hook of matchingHooks) {
      try {
        const result =
          typeof hook.action === 'function'
            ? await hook.action(activeEvent)
            : `executed ${hook.action}`;
        activeEvent.hookResults?.push(normalizeHookResult(hook.name, result));
      } catch (error) {
        activeEvent.hookResults?.push({
          name: hook.name,
          success: false,
          error: error instanceof Error ? error.message : String(error),
        });
      }
    }

    return activeEvent;
  }

  getHooks(): DeploymentHook[] {
    return [...this.hooks.values()].map((hook) => cloneHook(hook));
  }

  removeHook(name: string): boolean {
    return this.hooks.delete(name);
  }

  attachToSession(sessionId: string, context: DeploymentContext): void {
    this.sessionContexts.set(sessionId, cloneContext(context));
  }
}

export function loadDeploymentHooks(cwd = config.cwd): DeploymentHook[] {
  const filePath = configPath(cwd);
  try {
    if (!fs.existsSync(filePath)) return [];
    const parsed = JSON.parse(fs.readFileSync(filePath, 'utf8')) as unknown;
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(isDeploymentHook).map((hook) => ({
      name: hook.name,
      trigger: hook.trigger,
      action: hook.action,
    }));
  } catch {
    return [];
  }
}

export function formatDeploymentEvent(event: DeploymentEvent): string {
  const prefix = `${theme.badge(event.type.toUpperCase())} ${theme.hl(event.context.environment)} ${event.context.version}`;
  const session = event.sessionId ? ` ${theme.dim(`session:${event.sessionId}`)}` : '';
  const results =
    event.hookResults && event.hookResults.length > 0
      ? `\n${event.hookResults
          .map((result) =>
            result.success
              ? `${theme.ok('✔')} ${result.name}${result.output ? ` ${result.output}` : ''}`
              : `${theme.err('✖')} ${result.name} ${result.error ?? 'failed'}`,
          )
          .join('\n')}`
      : '';
  return `${prefix}${session}${results}`;
}
