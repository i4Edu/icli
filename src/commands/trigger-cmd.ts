import { theme } from '../ui/theme.js';
import {
  getFileTriggerManager,
  type FileTrigger,
  type FileTriggerManager,
} from '../workflows/file-trigger.js';
import { getBuiltinWorkflow } from '../workflows/builtins.js';
import { WorkflowEngine, type WorkflowDef, type WorkflowResult } from '../workflows/engine.js';

const triggerHandlers = new WeakSet<FileTriggerManager>();

export async function triggerCommand(args: string[], cwd: string): Promise<string> {
  const [subcommandRaw, ...rest] = args;
  const subcommand = (subcommandRaw || 'list').toLowerCase();
  const manager = getFileTriggerManager(cwd);

  switch (subcommand) {
    case 'add':
      return addTriggerCommand(manager, rest);
    case 'remove':
    case 'rm':
    case 'delete':
      return removeTriggerCommand(manager, rest);
    case 'list':
      return listTriggerCommand(manager);
    case 'start':
      ensureTriggerHandler(manager);
      manager.start(cwd);
      return theme.ok(`✔ trigger watcher started ${theme.dim(cwd)}\n`);
    case 'stop':
      manager.stop();
      return theme.ok('✔ trigger watcher stopped\n');
    default:
      return triggerUsage();
  }
}

function addTriggerCommand(manager: FileTriggerManager, args: string[]): string {
  const [pattern, actionRaw, ...targetParts] = args;
  const action = actionRaw as FileTrigger['action'] | undefined;
  const target = targetParts.join(' ').trim();

  if (!pattern || !action || !target) {
    return theme.warn('usage: /trigger add <pattern> <action> <target>\n');
  }
  if (!['workflow', 'command', 'prompt'].includes(action)) {
    return theme.warn(`invalid trigger action: ${action}\n`);
  }

  try {
    manager.addTrigger({ pattern, action, target });
    return theme.ok(`✔ trigger saved ${theme.dim(`${pattern} → ${action}:${target}`)}\n`);
  } catch (error) {
    return theme.err(`trigger: ${(error as Error).message}\n`);
  }
}

function removeTriggerCommand(manager: FileTriggerManager, args: string[]): string {
  const [pattern] = args;
  if (!pattern) return theme.warn('usage: /trigger remove <pattern>\n');

  const before = manager.listTriggers().length;
  manager.removeTrigger(pattern);
  return manager.listTriggers().length === before
    ? theme.warn(`trigger not found: ${pattern}\n`)
    : theme.ok(`✔ trigger removed ${pattern}\n`);
}

function listTriggerCommand(manager: FileTriggerManager): string {
  const triggers = manager.listTriggers();
  if (triggers.length === 0) return theme.dim('No file triggers configured.\n');

  const lines = triggers.map((trigger, index) => {
    const debounce = trigger.debounce ?? 500;
    return `  ${index + 1}. ${theme.hl(trigger.pattern)} ${theme.dim('→')} ${trigger.action}:${trigger.target} ${theme.dim(`(${debounce}ms)`)}`;
  });
  return `${theme.brand('File triggers')}\n${lines.join('\n')}\n`;
}

function triggerUsage(): string {
  return [
    theme.brand('Trigger command'),
    `  ${theme.hl('/trigger add <pattern> <action> <target>')}  ${theme.dim('save a file trigger')}`,
    `  ${theme.hl('/trigger remove <pattern>')}                 ${theme.dim('delete a file trigger')}`,
    `  ${theme.hl('/trigger list')}                             ${theme.dim('list configured triggers')}`,
    `  ${theme.hl('/trigger start')}                            ${theme.dim('start watching the project')}`,
    `  ${theme.hl('/trigger stop')}                             ${theme.dim('stop watching the project')}`,
    '',
  ].join('\n');
}

function ensureTriggerHandler(manager: FileTriggerManager): void {
  if (triggerHandlers.has(manager)) return;

  manager.onTrigger((trigger, file) => {
    void executeTriggerAction(trigger, file, manager.getRootDir());
  });
  triggerHandlers.add(manager);
}

async function executeTriggerAction(trigger: FileTrigger, file: string, cwd: string): Promise<void> {
  const renderedTarget = renderTriggerTarget(trigger.target, file, cwd);
  process.stdout.write(theme.dim(`\n[file-trigger] ${file} → ${trigger.action}:${renderedTarget}\n`));

  try {
    switch (trigger.action) {
      case 'workflow':
        await runTriggeredWorkflow(renderedTarget, file, cwd);
        break;
      case 'command':
        await runTriggeredCommand(renderedTarget, file, cwd);
        break;
      case 'prompt':
        process.stdout.write(`${theme.brand('Trigger prompt')} ${theme.dim(file)}\n${renderedTarget}\n`);
        break;
    }
  } catch (error) {
    process.stdout.write(theme.err(`trigger failed: ${(error as Error).message}\n`));
  }
}

async function runTriggeredWorkflow(name: string, file: string, cwd: string): Promise<void> {
  const engine = new WorkflowEngine({ cwd });
  const workflow =
    getBuiltinWorkflow(name) ?? engine.loadWorkflows(cwd).find((entry) => entry.name === name);
  if (!workflow) throw new Error(`workflow not found: ${name}`);

  const result = await engine.run(workflow, { cwd, file, triggerFile: file });
  process.stdout.write(formatTriggerRunResult(workflow.name, result));
}

async function runTriggeredCommand(command: string, file: string, cwd: string): Promise<void> {
  const engine = new WorkflowEngine({ cwd });
  const workflow: WorkflowDef = {
    name: `file-trigger:${command}`,
    description: `Run ${command} when ${file} changes.`,
    steps: [
      {
        id: 'run-trigger-command',
        name: 'Run trigger command',
        action: 'shell',
        params: { command, cwd },
        onFail: 'continue',
      },
    ],
  };
  const result = await engine.run(workflow, { cwd, file, triggerFile: file });
  process.stdout.write(formatTriggerRunResult(workflow.name, result));
}

function formatTriggerRunResult(name: string, result: WorkflowResult): string {
  const lines = [`${theme.brand('Trigger result')} ${theme.dim(name)}`];
  lines.push(`  success: ${theme.hl(result.success ? 'yes' : 'no')}`);

  for (const step of result.steps) {
    lines.push(`  - ${step.stepId}: ${step.success ? theme.ok('ok') : theme.err('failed')}`);
    if (typeof step.output === 'string' && step.output.trim()) lines.push(`    ${step.output.trim()}`);
    if (typeof step.error === 'string' && step.error.trim()) lines.push(`    ${step.error.trim()}`);
  }

  return `${lines.join('\n')}\n`;
}

function renderTriggerTarget(target: string, file: string, cwd: string): string {
  return target.replace(/\$\{file\}/g, file).replace(/\$\{cwd\}/g, cwd);
}
