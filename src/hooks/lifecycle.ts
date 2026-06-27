import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn, type ChildProcess, type SpawnOptions } from 'node:child_process';

/**
 * Supported lifecycle hook events.
 */
export type HookEvent =
  | 'sessionStart'
  | 'sessionEnd'
  | 'userPromptSubmit'
  | 'preToolUse'
  | 'postToolUse'
  | 'fileChanged'
  | 'cwdChanged'
  | 'preCompact'
  | 'postCompact'
  | 'errorOccurred';

/**
 * A single hook command definition loaded from hooks.json.
 */
export interface HookConfig {
  event: HookEvent;
  command: string;
  timeout?: number;
}

/**
 * The decision returned by a hook command.
 */
export interface HookResult {
  action: 'continue' | 'deny' | 'modify';
  reason?: string;
  modifications?: object;
}

interface HookFile {
  hooks?: HookConfig[];
}

type SpawnFn = (
  command: string,
  args?: ReadonlyArray<string>,
  options?: SpawnOptions,
) => ChildProcess;

/**
 * Loads lifecycle hook definitions and executes matching hooks for emitted events.
 */
export class HookManager {
  private hooks: HookConfig[] = [];
  private projectDir = process.cwd();
  private readonly homeDir: string;
  private readonly spawnFn: SpawnFn;

  constructor(options: { homeDir?: string; spawnFn?: SpawnFn } = {}) {
    const defaultSpawn: SpawnFn = (command, args, spawnOptions) =>
      (spawnOptions
        ? spawn(command, args ?? [], spawnOptions)
        : spawn(command, args ?? [])) as ChildProcess;
    this.homeDir = options.homeDir ?? os.homedir();
    this.spawnFn = options.spawnFn ?? defaultSpawn;
  }

  /**
   * Load hooks from the global ~/.icopilot/hooks.json file and the project-local
   * .icopilot/hooks.json file. Project hooks are applied after global hooks.
   */
  async loadHooks(projectDir: string): Promise<void> {
    this.projectDir = projectDir;
    const files = [
      path.join(this.homeDir, '.icopilot', 'hooks.json'),
      path.join(projectDir, '.icopilot', 'hooks.json'),
    ];
    this.hooks = files.flatMap((filePath) => this.readHookFile(filePath));
  }

  /**
   * Replace the active hook set. Intended for tests and in-memory scenarios.
   */
  replaceHooks(hooks: HookConfig[], projectDir = this.projectDir): void {
    this.projectDir = projectDir;
    this.hooks = hooks.map((hook) => normalizeHookConfig(hook)).filter(isHookConfig);
  }

  /**
   * Return the currently loaded hook definitions.
   */
  getHooks(): HookConfig[] {
    return this.hooks.map((hook) => ({ ...hook }));
  }

  /**
   * Emit a lifecycle event. The payload is written to each hook's stdin as JSON.
   * Hooks may deny the event, or modify the payload passed to later hooks.
   */
  async emit(event: HookEvent, payload: object): Promise<HookResult> {
    const candidates = this.hooks.filter((hook) => hook.event === event);
    if (!candidates.length) return { action: 'continue' };

    let activePayload: Record<string, unknown> = toRecord(payload);
    let finalModifications: Record<string, unknown> | undefined;
    let finalReason: string | undefined;

    for (const hook of candidates) {
      const result = await this.runHook(hook, activePayload);
      if (result.reason) finalReason = result.reason;
      if (result.action === 'deny') {
        return {
          action: 'deny',
          reason: result.reason ?? `hook denied ${event}`,
          modifications: result.modifications,
        };
      }
      if (result.action === 'modify' && result.modifications) {
        const normalized = toRecord(result.modifications);
        activePayload = { ...activePayload, ...normalized };
        finalModifications = { ...(finalModifications ?? {}), ...normalized };
      }
    }

    if (finalModifications && Object.keys(finalModifications).length > 0) {
      return { action: 'modify', reason: finalReason, modifications: finalModifications };
    }
    return { action: 'continue', reason: finalReason };
  }

  private readHookFile(filePath: string): HookConfig[] {
    try {
      if (!fs.existsSync(filePath)) return [];
      const parsed = JSON.parse(fs.readFileSync(filePath, 'utf8')) as HookFile;
      if (!parsed || typeof parsed !== 'object' || !Array.isArray(parsed.hooks)) return [];
      return parsed.hooks.map((hook) => normalizeHookConfig(hook)).filter(isHookConfig);
    } catch {
      return [];
    }
  }

  private runHook(hook: HookConfig, payload: Record<string, unknown>): Promise<HookResult> {
    return new Promise((resolve) => {
      const child = this.spawnFn(hook.command, [], {
        cwd: this.projectDir,
        shell: true,
        windowsHide: true,
        stdio: ['pipe', 'pipe', 'pipe'],
      });

      let stdout = '';
      let stderr = '';
      let settled = false;
      const timeoutMs = hook.timeout ?? 5_000;
      const timer = setTimeout(() => {
        if (settled) return;
        settled = true;
        try {
          child.kill();
        } catch {
          /* ignore */
        }
        resolve({
          action: 'continue',
          reason: `hook timed out after ${timeoutMs}ms: ${hook.command}`,
        });
      }, timeoutMs);

      child.stdout?.on('data', (chunk) => {
        stdout += String(chunk);
      });
      child.stderr?.on('data', (chunk) => {
        stderr += String(chunk);
      });
      child.on('error', (error) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        resolve({
          action: 'continue',
          reason: `hook failed: ${error instanceof Error ? error.message : String(error)}`,
        });
      });
      child.on('close', (code) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        resolve(parseHookOutput(stdout, stderr, code, hook.command));
      });

      child.stdin?.write(JSON.stringify(payload));
      child.stdin?.end();
    });
  }
}

/**
 * Shared lifecycle hook manager for the active CLI process.
 */
export const hookManager = new HookManager();

/**
 * Load lifecycle hooks for the active project directory.
 */
export async function initializeLifecycleHooks(projectDir: string): Promise<void> {
  await hookManager.loadHooks(projectDir);
}

function normalizeHookConfig(input: unknown): HookConfig {
  const candidate = input && typeof input === 'object' ? (input as Partial<HookConfig>) : {};
  return {
    event: candidate.event as HookEvent,
    command: typeof candidate.command === 'string' ? candidate.command : '',
    timeout: typeof candidate.timeout === 'number' ? candidate.timeout : undefined,
  };
}

function isHookConfig(hook: HookConfig): boolean {
  return (
    isHookEvent(hook.event) &&
    typeof hook.command === 'string' &&
    hook.command.trim().length > 0 &&
    (hook.timeout === undefined || (Number.isFinite(hook.timeout) && hook.timeout > 0))
  );
}

function isHookEvent(value: unknown): value is HookEvent {
  return (
    value === 'sessionStart' ||
    value === 'sessionEnd' ||
    value === 'userPromptSubmit' ||
    value === 'preToolUse' ||
    value === 'postToolUse' ||
    value === 'fileChanged' ||
    value === 'cwdChanged' ||
    value === 'preCompact' ||
    value === 'postCompact' ||
    value === 'errorOccurred'
  );
}

function parseHookOutput(
  stdout: string,
  stderr: string,
  code: number | null,
  command: string,
): HookResult {
  const trimmed = stdout.trim();
  if (trimmed) {
    try {
      const parsed = JSON.parse(trimmed) as Partial<HookResult>;
      if (parsed.action === 'continue' || parsed.action === 'deny' || parsed.action === 'modify') {
        return {
          action: parsed.action,
          reason: typeof parsed.reason === 'string' ? parsed.reason : undefined,
          modifications:
            parsed.modifications && typeof parsed.modifications === 'object'
              ? parsed.modifications
              : undefined,
        };
      }
    } catch {
      return { action: 'continue', reason: trimmed };
    }
  }

  const stderrText = stderr.trim();
  if (stderrText || code) {
    return {
      action: 'continue',
      reason: stderrText || `hook exited with code ${String(code)}: ${command}`,
    };
  }
  return { action: 'continue' };
}

function toRecord(value: unknown): Record<string, unknown> {
  if (value && typeof value === 'object' && !Array.isArray(value)) {
    return { ...(value as Record<string, unknown>) };
  }
  return {};
}
