import fs from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { config } from '../config.js';
import { parse } from 'yaml';

export interface WorkflowDef {
  name: string;
  description: string;
  steps: WorkflowStep[];
  triggers?: Trigger[];
}

export interface WorkflowStep {
  id: string;
  name: string;
  action: 'command' | 'prompt' | 'shell' | 'condition' | 'loop';
  params: Record<string, any>;
  onFail?: 'stop' | 'continue' | 'retry';
}

export interface Trigger {
  type: 'manual' | 'file-change' | 'schedule' | 'hook';
  config: Record<string, any>;
}

export interface ValidationError {
  path: string;
  message: string;
}

export interface WorkflowResult {
  success: boolean;
  steps: StepResult[];
  duration: number;
}

export interface StepResult {
  stepId: string;
  success: boolean;
  output?: any;
  error?: string;
  duration: number;
}

interface ExecutionState {
  context: Record<string, any>;
  prev?: StepResult;
  steps: Record<string, StepResult>;
  workflow?: WorkflowDef;
  loop?: {
    index: number;
    item: any;
    items: any[];
  };
}

export class WorkflowEngine {
  private readonly cwd: string;
  private execution: ExecutionState;

  constructor(opts: { cwd?: string } = {}) {
    this.cwd = path.resolve(opts.cwd ?? config.cwd);
    this.execution = this.createExecutionState();
  }

  loadWorkflows(dir: string): WorkflowDef[] {
    const workflowDir = this.resolveWorkflowDir(dir);
    if (!fs.existsSync(workflowDir) || !fs.statSync(workflowDir).isDirectory()) {
      return [];
    }

    return fs
      .readdirSync(workflowDir)
      .filter((entry) => entry.endsWith('.yaml') || entry.endsWith('.yml'))
      .sort((a, b) => a.localeCompare(b))
      .map((entry) => {
        const filePath = path.join(workflowDir, entry);
        const raw = fs.readFileSync(filePath, 'utf8');

        let parsed: unknown;
        try {
          parsed = parse(raw);
        } catch (error: any) {
          throw new Error(`Failed to parse workflow ${entry}: ${error?.message || String(error)}`);
        }

        if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
          throw new Error(`Workflow ${entry} must contain a YAML object`);
        }

        return parsed as WorkflowDef;
      });
  }

  async run(workflow: WorkflowDef, context: any = {}): Promise<WorkflowResult> {
    const startedAt = Date.now();
    const validationErrors = this.validateWorkflow(workflow);
    if (validationErrors.length > 0) {
      return {
        success: false,
        duration: Date.now() - startedAt,
        steps: validationErrors.map((error, index) => ({
          stepId: `validation-${index + 1}`,
          success: false,
          error: `${error.path}: ${error.message}`,
          duration: 0,
        })),
      };
    }

    this.execution = this.createExecutionState(context, workflow);
    const steps: StepResult[] = [];

    for (const step of workflow.steps) {
      const result = await this.runStep(step);
      steps.push(result);
      this.execution.prev = result;
      this.execution.steps[step.id] = result;

      if (!result.success && (step.onFail ?? 'stop') === 'stop') {
        break;
      }
    }

    return {
      success: steps.length === workflow.steps.length && steps.every((step) => step.success),
      steps,
      duration: Date.now() - startedAt,
    };
  }

  async runStep(step: WorkflowStep): Promise<StepResult> {
    const startedAt = Date.now();
    const retryAttempts = step.onFail === 'retry' ? this.normalizeRetryCount(step.params?.retries) : 0;

    for (let attempt = 0; ; attempt += 1) {
      try {
        const result = await this.executeStep(step);
        return { ...result, duration: Date.now() - startedAt };
      } catch (error: any) {
        const failure: StepResult = {
          stepId: step.id,
          success: false,
          error: error?.message || String(error),
          duration: Date.now() - startedAt,
        };

        if (attempt >= retryAttempts) {
          return failure;
        }
      }
    }
  }

  validateWorkflow(def: WorkflowDef): ValidationError[] {
    const errors: ValidationError[] = [];
    if (!def || typeof def !== 'object' || Array.isArray(def)) {
      return [{ path: 'workflow', message: 'Workflow definition must be an object' }];
    }

    if (!this.isNonEmptyString(def.name)) {
      errors.push({ path: 'name', message: 'Workflow name is required' });
    }
    if (!this.isNonEmptyString(def.description)) {
      errors.push({ path: 'description', message: 'Workflow description is required' });
    }
    if (!Array.isArray(def.steps) || def.steps.length === 0) {
      errors.push({ path: 'steps', message: 'Workflow must include at least one step' });
    }

    const seenStepIds = new Set<string>();
    for (const [index, step] of (def.steps ?? []).entries()) {
      const stepPath = `steps[${index}]`;
      if (!step || typeof step !== 'object' || Array.isArray(step)) {
        errors.push({ path: stepPath, message: 'Step must be an object' });
        continue;
      }
      if (!this.isNonEmptyString(step.id)) {
        errors.push({ path: `${stepPath}.id`, message: 'Step id is required' });
      } else if (seenStepIds.has(step.id)) {
        errors.push({ path: `${stepPath}.id`, message: `Duplicate step id "${step.id}"` });
      } else {
        seenStepIds.add(step.id);
      }
      if (!this.isNonEmptyString(step.name)) {
        errors.push({ path: `${stepPath}.name`, message: 'Step name is required' });
      }
      if (!['command', 'prompt', 'shell', 'condition', 'loop'].includes(step.action)) {
        errors.push({ path: `${stepPath}.action`, message: `Unsupported step action "${step.action}"` });
      }
      if (!step.params || typeof step.params !== 'object' || Array.isArray(step.params)) {
        errors.push({ path: `${stepPath}.params`, message: 'Step params must be an object' });
        continue;
      }

      switch (step.action) {
        case 'command':
          if (!this.isNonEmptyString(step.params.command)) {
            errors.push({ path: `${stepPath}.params.command`, message: 'command step requires params.command' });
          }
          if (step.params.args !== undefined && !Array.isArray(step.params.args)) {
            errors.push({ path: `${stepPath}.params.args`, message: 'command step params.args must be an array' });
          }
          break;
        case 'prompt':
          if (!this.isNonEmptyString(step.params.prompt) && !this.isNonEmptyString(step.params.template)) {
            errors.push({
              path: `${stepPath}.params.prompt`,
              message: 'prompt step requires params.prompt or params.template',
            });
          }
          break;
        case 'shell':
          if (!this.isNonEmptyString(step.params.command) && !this.isNonEmptyString(step.params.script)) {
            errors.push({
              path: `${stepPath}.params.command`,
              message: 'shell step requires params.command or params.script',
            });
          }
          break;
        case 'condition':
          if (
            step.params.if === undefined &&
            step.params.expression === undefined &&
            step.params.value === undefined
          ) {
            errors.push({
              path: `${stepPath}.params.if`,
              message: 'condition step requires params.if, params.expression, or params.value',
            });
          }
          if (step.params.then !== undefined && !this.isStepArray(step.params.then)) {
            errors.push({ path: `${stepPath}.params.then`, message: 'condition step params.then must be a step array' });
          }
          if (step.params.else !== undefined && !this.isStepArray(step.params.else)) {
            errors.push({ path: `${stepPath}.params.else`, message: 'condition step params.else must be a step array' });
          }
          break;
        case 'loop':
          if (step.params.items === undefined) {
            errors.push({ path: `${stepPath}.params.items`, message: 'loop step requires params.items' });
          }
          if (!this.isStepArray(step.params.steps)) {
            errors.push({ path: `${stepPath}.params.steps`, message: 'loop step requires params.steps as an array' });
          }
          break;
      }
    }

    for (const [index, trigger] of (def.triggers ?? []).entries()) {
      const triggerPath = `triggers[${index}]`;
      if (!trigger || typeof trigger !== 'object' || Array.isArray(trigger)) {
        errors.push({ path: triggerPath, message: 'Trigger must be an object' });
        continue;
      }
      if (!['manual', 'file-change', 'schedule', 'hook'].includes(trigger.type)) {
        errors.push({ path: `${triggerPath}.type`, message: `Unsupported trigger type "${trigger.type}"` });
      }
      if (!trigger.config || typeof trigger.config !== 'object' || Array.isArray(trigger.config)) {
        errors.push({ path: `${triggerPath}.config`, message: 'Trigger config must be an object' });
      }
    }

    return errors;
  }

  private async executeStep(step: WorkflowStep): Promise<Omit<StepResult, 'duration'>> {
    switch (step.action) {
      case 'command':
        return this.executeCommandStep(step, this.interpolate(step.params));
      case 'prompt':
        return {
          stepId: step.id,
          success: true,
          output: String(this.interpolate(step.params.prompt ?? step.params.template ?? '')),
        };
      case 'shell':
        return this.executeShellStep(step, this.interpolate(step.params));
      case 'condition':
        return this.executeConditionStep(step, step.params);
      case 'loop':
        return this.executeLoopStep(step, step.params);
      default:
        throw new Error(`Unsupported workflow action: ${step.action}`);
    }
  }

  private async executeCommandStep(
    step: WorkflowStep,
    params: Record<string, any>,
  ): Promise<Omit<StepResult, 'duration'>> {
    const command = String(params.command);
    const args = Array.isArray(params.args) ? params.args.map((arg) => String(arg)) : [];
    const cwd = this.resolveCwd(params.cwd);
    const result = await this.runProcess(command, args, cwd, false);
    return {
      stepId: step.id,
      success: result.exitCode === 0,
      output: result.stdout,
      error: result.exitCode === 0 ? undefined : result.stderr || `Command exited with code ${result.exitCode}`,
    };
  }

  private async executeShellStep(
    step: WorkflowStep,
    params: Record<string, any>,
  ): Promise<Omit<StepResult, 'duration'>> {
    const shellCommand = String(params.command ?? params.script ?? '');
    const cwd = this.resolveCwd(params.cwd);
    const shell = process.platform === 'win32' ? 'powershell.exe' : 'bash';
    const shellArgs = process.platform === 'win32' ? ['-NoProfile', '-Command', shellCommand] : ['-lc', shellCommand];
    const result = await this.runProcess(shell, shellArgs, cwd, false);
    return {
      stepId: step.id,
      success: result.exitCode === 0,
      output: result.stdout,
      error: result.exitCode === 0 ? undefined : result.stderr || `Shell exited with code ${result.exitCode}`,
    };
  }

  private async executeConditionStep(
    step: WorkflowStep,
    params: Record<string, any>,
  ): Promise<Omit<StepResult, 'duration'>> {
    const rawCondition = this.interpolate(params.if ?? params.expression ?? params.value);
    const passed = this.toBoolean(rawCondition);
    const branchSteps = this.normalizeNestedSteps(passed ? params.then : params.else);
    const branchResults = await this.executeNestedSteps(branchSteps);
    const branchSucceeded = branchResults.every((result) => result.success);

    return {
      stepId: step.id,
      success: branchSucceeded,
      output: {
        passed,
        branch: passed ? 'then' : 'else',
        steps: branchResults,
      },
    };
  }

  private async executeLoopStep(
    step: WorkflowStep,
    params: Record<string, any>,
  ): Promise<Omit<StepResult, 'duration'>> {
    const items = this.normalizeLoopItems(this.interpolate(params.items));
    const nestedSteps = this.normalizeNestedSteps(params.steps);
    const previousLoop = this.execution.loop;
    const loopResults: Array<{ index: number; item: any; steps: StepResult[] }> = [];
    let success = true;

    try {
      for (const [index, item] of items.entries()) {
        this.execution.loop = { index, item, items };
        const results = await this.executeNestedSteps(nestedSteps);
        loopResults.push({ index, item, steps: results });
        if (!results.every((result) => result.success)) {
          success = false;
          break;
        }
      }
    } finally {
      this.execution.loop = previousLoop;
    }

    return {
      stepId: step.id,
      success,
      output: loopResults,
    };
  }

  private async executeNestedSteps(steps: WorkflowStep[]): Promise<StepResult[]> {
    const results: StepResult[] = [];
    for (const step of steps) {
      const result = await this.runStep(step);
      results.push(result);
      this.execution.prev = result;
      this.execution.steps[step.id] = result;

      if (!result.success && (step.onFail ?? 'stop') === 'stop') {
        break;
      }
    }
    return results;
  }

  private interpolate<T>(value: T): T {
    if (typeof value === 'string') {
      return this.interpolateString(value) as T;
    }
    if (Array.isArray(value)) {
      return value.map((item) => this.interpolate(item)) as T;
    }
    if (value && typeof value === 'object') {
      return Object.fromEntries(
        Object.entries(value).map(([key, item]) => [key, this.interpolate(item)]),
      ) as T;
    }
    return value;
  }

  private interpolateString(template: string): any {
    const exactMatch = template.match(/^\$\{([^}]+)\}$/);
    if (exactMatch) {
      return this.resolveVariable(exactMatch[1].trim());
    }

    return template.replace(/\$\{([^}]+)\}/g, (_match, expression) =>
      this.renderInterpolatedValue(this.resolveVariable(String(expression).trim())),
    );
  }

  private resolveVariable(expression: string): any {
    const normalized = expression.replace(/\[(\d+)\]/g, '.$1');
    const segments = normalized.split('.').filter(Boolean);
    if (segments.length === 0) return undefined;

    const [root, ...rest] = segments;
    let current: any;
    switch (root) {
      case 'prev':
        current = this.execution.prev;
        break;
      case 'context':
        current = this.execution.context;
        break;
      case 'steps':
        current = this.execution.steps;
        break;
      case 'workflow':
        current = this.execution.workflow;
        break;
      case 'loop':
        current = this.execution.loop;
        break;
      default:
        current =
          this.execution.context[root] !== undefined ? this.execution.context[root] : this.execution.steps[root];
        break;
    }

    for (const segment of rest) {
      if (current == null) return undefined;
      current = current[segment];
    }

    return current;
  }

  private renderInterpolatedValue(value: any): string {
    if (value == null) return '';
    if (typeof value === 'string') return value;
    return JSON.stringify(value);
  }

  private toBoolean(value: any): boolean {
    if (typeof value === 'boolean') return value;
    if (typeof value === 'number') return value !== 0;
    if (typeof value === 'string') {
      const normalized = value.trim().toLowerCase();
      if (normalized === '' || normalized === 'false' || normalized === '0' || normalized === 'no') {
        return false;
      }
      return true;
    }
    if (Array.isArray(value)) return value.length > 0;
    return Boolean(value);
  }

  private normalizeLoopItems(value: any): any[] {
    if (Array.isArray(value)) return value;
    if (typeof value === 'number' && Number.isFinite(value) && value >= 0) {
      return Array.from({ length: Math.floor(value) }, (_item, index) => index);
    }
    if (value && typeof value === 'object') return Object.values(value);
    return [];
  }

  private normalizeNestedSteps(value: any): WorkflowStep[] {
    if (!Array.isArray(value)) return [];
    return value as WorkflowStep[];
  }

  private resolveWorkflowDir(inputDir: string): string {
    const absolute = path.resolve(inputDir);
    const directDir = absolute;
    const nestedDir = path.join(absolute, '.icopilot', 'workflows');

    if (fs.existsSync(directDir) && path.basename(directDir) === 'workflows') {
      return directDir;
    }
    if (fs.existsSync(nestedDir)) {
      return nestedDir;
    }
    return directDir;
  }

  private resolveCwd(candidate: unknown): string {
    const baseDir = this.execution.context.cwd ?? this.cwd;
    if (typeof candidate !== 'string' || candidate.trim() === '') {
      return path.resolve(baseDir);
    }
    return path.resolve(baseDir, candidate);
  }

  private normalizeRetryCount(value: unknown): number {
    if (typeof value === 'number' && Number.isFinite(value) && value >= 0) {
      return Math.floor(value);
    }
    return 1;
  }

  private async runProcess(
    command: string,
    args: string[],
    cwd: string,
    useShell: boolean,
  ): Promise<{ exitCode: number | null; stdout: string; stderr: string }> {
    return new Promise((resolve, reject) => {
      const child = spawn(command, args, {
        cwd,
        shell: useShell && process.platform === 'win32',
        stdio: ['ignore', 'pipe', 'pipe'],
      });

      let stdout = '';
      let stderr = '';

      child.stdout.on('data', (chunk) => {
        stdout += chunk.toString();
      });
      child.stderr.on('data', (chunk) => {
        stderr += chunk.toString();
      });
      child.on('error', (error) => {
        reject(error);
      });
      child.on('close', (exitCode) => {
        resolve({
          exitCode,
          stdout: stdout.trim(),
          stderr: stderr.trim(),
        });
      });
    });
  }

  private createExecutionState(context: any = {}, workflow?: WorkflowDef): ExecutionState {
    return {
      context: {
        ...(context && typeof context === 'object' ? context : {}),
        cwd:
          context && typeof context === 'object' && typeof context.cwd === 'string'
            ? context.cwd
            : this.cwd,
      },
      steps: {},
      workflow,
    };
  }

  private isNonEmptyString(value: unknown): value is string {
    return typeof value === 'string' && value.trim().length > 0;
  }

  private isStepArray(value: unknown): value is WorkflowStep[] {
    return Array.isArray(value);
  }
}
