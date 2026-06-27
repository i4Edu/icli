import { stringify } from 'yaml';
import type { WorkflowDef } from './engine.js';

export const BUILTIN_WORKFLOWS: WorkflowDef[] = [
  {
    name: 'review-and-commit',
    description: 'Inspect the working tree, summarize changes, and prepare a commit message.',
    triggers: [{ type: 'manual', config: {} }],
    steps: [
      {
        id: 'git-status',
        name: 'Capture git status',
        action: 'shell',
        params: { command: 'git --no-pager status --short' },
        onFail: 'stop',
      },
      {
        id: 'diff-summary',
        name: 'Capture diff summary',
        action: 'shell',
        params: { command: 'git --no-pager diff --stat' },
        onFail: 'continue',
      },
      {
        id: 'commit-prompt',
        name: 'Draft commit guidance',
        action: 'prompt',
        params: {
          prompt:
            'Review this status and diff summary, then draft a conventional commit message:\n\nStatus:\n${steps.git-status.output}\n\nDiff:\n${steps.diff-summary.output}',
        },
      },
    ],
  },
  {
    name: 'test-fix-loop',
    description: 'Run tests, summarize failures, and iterate through follow-up prompts.',
    triggers: [{ type: 'manual', config: {} }],
    steps: [
      {
        id: 'run-tests',
        name: 'Run repository tests',
        action: 'shell',
        params: { command: 'npm test -- --runInBand', retries: 1 },
        onFail: 'continue',
      },
      {
        id: 'failure-summary',
        name: 'Summarize failures',
        action: 'prompt',
        params: {
          prompt: 'Summarize the latest test run and propose the smallest fix:\n\n${steps.run-tests.output}',
        },
      },
      {
        id: 'follow-up-loop',
        name: 'Generate retry prompts',
        action: 'loop',
        params: {
          items: ['re-run targeted tests', 'verify typecheck', 'prepare regression summary'],
          steps: [
            {
              id: 'loop-prompt',
              name: 'Draft a follow-up action',
              action: 'prompt',
              params: {
                prompt: 'Next action ${loop.index}: ${loop.item}\nLatest output:\n${steps.run-tests.output}',
              },
            },
          ],
        },
      },
    ],
  },
  {
    name: 'release-prep',
    description: 'Collect the core checks needed before shipping a release.',
    triggers: [
      { type: 'manual', config: {} },
      { type: 'schedule', config: { cron: '0 9 * * 1-5' } },
    ],
    steps: [
      {
        id: 'typecheck',
        name: 'Run typecheck',
        action: 'shell',
        params: { command: 'npm run typecheck' },
        onFail: 'continue',
      },
      {
        id: 'tests',
        name: 'Run tests',
        action: 'shell',
        params: { command: 'npm test' },
        onFail: 'continue',
      },
      {
        id: 'release-notes',
        name: 'Draft release checklist',
        action: 'prompt',
        params: {
          prompt:
            'Prepare a release checklist using the latest typecheck and test output.\n\nTypecheck:\n${steps.typecheck.output}\n\nTests:\n${steps.tests.output}',
        },
      },
    ],
  },
];

export function getBuiltinWorkflow(name: string): WorkflowDef | undefined {
  return BUILTIN_WORKFLOWS.find((workflow) => workflow.name === name);
}

export function renderWorkflowYaml(workflow: WorkflowDef): string {
  return `${stringify(workflow).trimEnd()}\n`;
}

export function createWorkflowTemplate(name: string): WorkflowDef {
  return {
    name,
    description: `Describe what the ${name} workflow should do.`,
    triggers: [{ type: 'manual', config: {} }],
    steps: [
      {
        id: 'first-step',
        name: 'First step',
        action: 'prompt',
        params: {
          prompt: `Workflow ${name} is ready. Replace this prompt with real steps.`,
        },
        onFail: 'stop',
      },
    ],
  };
}
