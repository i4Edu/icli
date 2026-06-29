import fs from 'node:fs';
import path from 'node:path';
import { theme } from '../ui/theme.js';

type Scalar = string | number | boolean;
type TriggerName = 'push' | 'pull_request' | 'release' | 'workflow_dispatch' | 'schedule';

export interface Step {
  name?: string;
  uses?: string;
  run?: string;
  with?: Record<string, Scalar>;
  env?: Record<string, Scalar>;
  shell?: string;
  comment?: string;
}

export interface Job {
  name: string;
  runsOn: string;
  steps: Step[];
  needs?: string[];
  permissions?: Record<string, Scalar>;
  env?: Record<string, Scalar>;
}

export interface WorkflowTemplate {
  name: string;
  triggers: Partial<Record<TriggerName, TriggerConfig>>;
  jobs: Job[];
}

export interface TriggerConfig {
  branches?: string[];
  tags?: string[];
  types?: string[];
  cron?: string[];
}

interface WorkflowValidationResult {
  file: string;
  errors: string[];
}

interface TemplateMatch {
  name: string;
  test: (description: string) => boolean;
  template: WorkflowTemplate;
}

const DEFAULT_BRANCHES = ['main', 'master'];
const WORKFLOW_DIRECTORY = ['.github', 'workflows'];

const TEMPLATE_LIBRARY: TemplateMatch[] = [
  {
    name: 'CI',
    test: (description) =>
      /\b(ci|build|test|unit test|integration test|pull request|pr|push)\b/u.test(description),
    template: {
      name: 'CI',
      triggers: {
        push: { branches: DEFAULT_BRANCHES },
        pull_request: { branches: DEFAULT_BRANCHES },
      },
      jobs: [
        {
          name: 'Build and test',
          runsOn: 'ubuntu-latest',
          steps: [
            {
              comment: 'Check out the repository before running build and test steps.',
              uses: 'actions/checkout@v4',
            },
            {
              name: 'Setup Node.js',
              comment: 'Use a current Node.js LTS runtime with npm caching enabled.',
              uses: 'actions/setup-node@v4',
              with: {
                'node-version': 20,
                cache: 'npm',
              },
            },
            {
              name: 'Install dependencies',
              run: 'npm ci',
            },
            {
              name: 'Build',
              run: 'npm run build --if-present',
            },
            {
              name: 'Run tests',
              run: 'npm test --if-present',
            },
          ],
        },
      ],
    },
  },
  {
    name: 'CD',
    test: (description) => /\b(cd|deploy|deployment|publish|tag|release)\b/u.test(description),
    template: {
      name: 'CD',
      triggers: {
        push: { tags: ['v*'] },
        release: { types: ['published'] },
      },
      jobs: [
        {
          name: 'Deploy',
          runsOn: 'ubuntu-latest',
          steps: [
            {
              comment: 'Fetch the code that is being deployed.',
              uses: 'actions/checkout@v4',
            },
            {
              name: 'Setup Node.js',
              uses: 'actions/setup-node@v4',
              with: {
                'node-version': 20,
                cache: 'npm',
              },
            },
            {
              name: 'Install dependencies',
              run: 'npm ci',
            },
            {
              name: 'Build release artifacts',
              run: 'npm run build --if-present',
            },
            {
              name: 'Deploy application',
              comment: 'Replace this placeholder with the deployment command for your environment.',
              run: 'npm run deploy --if-present',
            },
          ],
        },
      ],
    },
  },
  {
    name: 'Lint',
    test: (description) => /\b(lint|eslint|prettier|format)\b/u.test(description),
    template: {
      name: 'Lint',
      triggers: {
        pull_request: { branches: DEFAULT_BRANCHES },
      },
      jobs: [
        {
          name: 'Lint and format',
          runsOn: 'ubuntu-latest',
          steps: [
            {
              comment: 'Check out the repository before static analysis.',
              uses: 'actions/checkout@v4',
            },
            {
              name: 'Setup Node.js',
              uses: 'actions/setup-node@v4',
              with: {
                'node-version': 20,
                cache: 'npm',
              },
            },
            {
              name: 'Install dependencies',
              run: 'npm ci',
            },
            {
              name: 'Run ESLint',
              run: 'npm run lint --if-present',
            },
            {
              name: 'Check formatting',
              run: 'npm run format:check --if-present',
            },
          ],
        },
      ],
    },
  },
  {
    name: 'Security',
    test: (description) =>
      /\b(security|audit|dependency audit|vulnerability|dependencies)\b/u.test(description),
    template: {
      name: 'Security',
      triggers: {
        pull_request: { branches: DEFAULT_BRANCHES },
        schedule: { cron: ['0 6 * * 1'] },
      },
      jobs: [
        {
          name: 'Dependency audit',
          runsOn: 'ubuntu-latest',
          steps: [
            {
              comment: 'Use the repository state from the triggering commit or pull request.',
              uses: 'actions/checkout@v4',
            },
            {
              name: 'Setup Node.js',
              uses: 'actions/setup-node@v4',
              with: {
                'node-version': 20,
                cache: 'npm',
              },
            },
            {
              name: 'Install dependencies',
              run: 'npm ci',
            },
            {
              name: 'Run npm audit',
              run: 'npm audit --audit-level=high',
            },
          ],
        },
      ],
    },
  },
  {
    name: 'Release',
    test: (description) =>
      /\b(semantic-release|semantic release|release automation|automated release)\b/u.test(
        description,
      ),
    template: {
      name: 'Release',
      triggers: {
        push: { branches: ['main'] },
        workflow_dispatch: {},
      },
      jobs: [
        {
          name: 'Semantic release',
          runsOn: 'ubuntu-latest',
          permissions: {
            contents: 'write',
            issues: 'write',
            'pull-requests': 'write',
          },
          steps: [
            {
              comment:
                'Check out the full git history so semantic-release can inspect tags and commits.',
              uses: 'actions/checkout@v4',
              with: {
                'fetch-depth': 0,
              },
            },
            {
              name: 'Setup Node.js',
              uses: 'actions/setup-node@v4',
              with: {
                'node-version': 20,
                cache: 'npm',
              },
            },
            {
              name: 'Install dependencies',
              run: 'npm ci',
            },
            {
              name: 'Build',
              run: 'npm run build --if-present',
            },
            {
              name: 'Run semantic-release',
              env: {
                GITHUB_TOKEN: '${{ secrets.GITHUB_TOKEN }}',
              },
              run: 'npx semantic-release',
            },
          ],
        },
      ],
    },
  },
];

export function actionsCommand(args: string[], cwd: string): string {
  const [subcommand, ...rest] = args;
  const normalized = subcommand?.toLowerCase();

  if (!subcommand) {
    return usage();
  }

  if (normalized === 'list') {
    return listWorkflows(cwd);
  }

  if (normalized === 'validate') {
    return validateWorkflows(cwd);
  }

  const description = args.join(' ').trim();
  if (!description) {
    return usage();
  }

  const fileName = suggestWorkflowFileName(description);
  const yaml = generateWorkflow(description);
  return [
    `${theme.brand('Generated workflow')} ${theme.dim(`save as .github/workflows/${fileName}`)}`,
    '',
    yaml,
    '',
  ].join('\n');
}

export function generateWorkflow(description: string): string {
  const normalized = description.trim().toLowerCase();
  const selectedTemplates = selectTemplates(normalized);
  const workflow = mergeTemplates(selectedTemplates, description.trim());
  return renderWorkflow(
    workflow,
    description.trim(),
    selectedTemplates.map((entry) => entry.name),
  );
}

export function validateWorkflowYaml(content: string): string[] {
  const lines = content.split(/\r?\n/u);
  const errors: string[] = [];
  const meaningfulLines = lines.filter((line) => {
    const trimmed = line.trim();
    return trimmed.length > 0 && !trimmed.startsWith('#');
  });

  if (meaningfulLines.length === 0) {
    return ['workflow file is empty'];
  }

  if (lines.some((line) => line.includes('\t'))) {
    errors.push('tab indentation is not supported; use spaces only');
  }

  if (!meaningfulLines.some((line) => /^name:\s+\S/u.test(line))) {
    errors.push('missing top-level "name" field');
  }

  const hasOnBlock =
    meaningfulLines.some((line) => line === 'on:' || /^on:\s+\S/u.test(line)) ||
    meaningfulLines.some((line) => /^"on":\s+\S/u.test(line));
  if (!hasOnBlock) {
    errors.push('missing top-level "on" trigger block');
  }

  const jobsIndex = meaningfulLines.findIndex(
    (line) => line === 'jobs:' || /^jobs:\s*$/u.test(line),
  );
  if (jobsIndex === -1) {
    errors.push('missing top-level "jobs" block');
    return errors;
  }

  const jobLines = meaningfulLines.slice(jobsIndex + 1);
  const jobKeys = jobLines.filter((line) => /^ {2}[A-Za-z0-9_-]+:\s*$/u.test(line));
  if (jobKeys.length === 0) {
    errors.push('jobs block must define at least one job');
  }

  for (const jobKey of jobKeys) {
    const match = /^ {2}([A-Za-z0-9_-]+):\s*$/u.exec(jobKey);
    const jobId = match?.[1];
    if (!jobId) continue;

    const jobSection = sliceJobSection(meaningfulLines, jobId);
    if (!jobSection.some((line) => /^ {4}runs-on:\s+\S/u.test(line))) {
      errors.push(`job "${jobId}" is missing "runs-on"`);
    }
    if (!jobSection.some((line) => /^ {4}steps:\s*$/u.test(line))) {
      errors.push(`job "${jobId}" is missing "steps"`);
      continue;
    }
    if (!jobSection.some((line) => /^ {6}-(?:\s|$)/u.test(line))) {
      errors.push(`job "${jobId}" must include at least one step`);
    }
  }

  return errors;
}

function usage(): string {
  return [
    theme.brand('Actions command'),
    `  ${theme.hl('/actions <description>')}  ${theme.dim('generate a GitHub Actions workflow from natural language')}`,
    `  ${theme.hl('/actions list')}           ${theme.dim('list existing workflow files in .github/workflows')}`,
    `  ${theme.hl('/actions validate')}       ${theme.dim('run a lightweight validation pass on existing workflow YAML')}`,
    '',
  ].join('\n');
}

function workflowDir(cwd: string): string {
  return path.join(cwd, ...WORKFLOW_DIRECTORY);
}

function listWorkflows(cwd: string): string {
  const files = getWorkflowFiles(cwd);
  if (files.length === 0) {
    return `${theme.warn('No workflow files found in .github/workflows.')}\n`;
  }

  const lines = files.map((file) => {
    const filePath = path.join(workflowDir(cwd), file);
    const lineCount = readFile(filePath).split(/\r?\n/u).length;
    return `  ${theme.ok(file)} ${theme.dim(`(${lineCount} lines)`)}`;
  });

  return `${theme.brand('Existing workflows')}\n${lines.join('\n')}\n`;
}

function validateWorkflows(cwd: string): string {
  const files = getWorkflowFiles(cwd);
  if (files.length === 0) {
    return `${theme.warn('No workflow files found to validate.')}\n`;
  }

  const results: WorkflowValidationResult[] = files.map((file) => {
    const filePath = path.join(workflowDir(cwd), file);
    return {
      file,
      errors: validateWorkflowYaml(readFile(filePath)),
    };
  });

  const validCount = results.filter((result) => result.errors.length === 0).length;
  const invalidCount = results.length - validCount;
  const lines = results.flatMap((result) => {
    if (result.errors.length === 0) {
      return [`  ${theme.ok('valid')} ${result.file}`];
    }

    return [
      `  ${theme.err('invalid')} ${result.file}`,
      ...result.errors.map((error) => `    - ${error}`),
    ];
  });

  return [
    theme.brand('Workflow validation'),
    `  checked: ${theme.hl(String(results.length))}  valid: ${theme.ok(String(validCount))}  invalid: ${invalidCount > 0 ? theme.err(String(invalidCount)) : theme.ok('0')}`,
    '',
    ...lines,
    '',
  ].join('\n');
}

function readFile(filePath: string): string {
  try {
    return fs.readFileSync(filePath, 'utf8');
  } catch {
    return '';
  }
}

function getWorkflowFiles(cwd: string): string[] {
  const directory = workflowDir(cwd);
  try {
    return fs
      .readdirSync(directory, { withFileTypes: true })
      .filter((entry) => entry.isFile() && /\.(?:ya?ml)$/iu.test(entry.name))
      .map((entry) => entry.name)
      .sort((left, right) => left.localeCompare(right));
  } catch {
    return [];
  }
}

function selectTemplates(description: string): TemplateMatch[] {
  const matches = TEMPLATE_LIBRARY.filter((entry) => entry.test(description));
  return matches.length > 0 ? matches : [TEMPLATE_LIBRARY[0]!];
}

function mergeTemplates(selectedTemplates: TemplateMatch[], description: string): WorkflowTemplate {
  const workflow: WorkflowTemplate = {
    name: buildWorkflowName(selectedTemplates, description),
    triggers: {},
    jobs: [],
  };

  for (const entry of selectedTemplates) {
    for (const [triggerName, config] of Object.entries(entry.template.triggers) as Array<
      [TriggerName, TriggerConfig | undefined]
    >) {
      if (!config) continue;
      workflow.triggers[triggerName] = mergeTriggerConfig(workflow.triggers[triggerName], config);
    }

    for (const job of entry.template.jobs) {
      workflow.jobs.push(cloneJob(job));
    }
  }

  return workflow;
}

function mergeTriggerConfig(
  current: TriggerConfig | undefined,
  next: TriggerConfig | undefined,
): TriggerConfig {
  const merged: TriggerConfig = {
    branches: mergeStringLists(current?.branches, next?.branches),
    tags: mergeStringLists(current?.tags, next?.tags),
    types: mergeStringLists(current?.types, next?.types),
    cron: mergeStringLists(current?.cron, next?.cron),
  };

  return Object.fromEntries(
    Object.entries(merged).filter(([, value]) => Array.isArray(value) && value.length > 0),
  ) as TriggerConfig;
}

function mergeStringLists(left?: string[], right?: string[]): string[] | undefined {
  const values = [...(left ?? []), ...(right ?? [])];
  if (values.length === 0) return undefined;
  return [...new Set(values)];
}

function cloneJob(job: Job): Job {
  return {
    ...job,
    needs: job.needs ? [...job.needs] : undefined,
    permissions: job.permissions ? { ...job.permissions } : undefined,
    env: job.env ? { ...job.env } : undefined,
    steps: job.steps.map((step) => ({
      ...step,
      with: step.with ? { ...step.with } : undefined,
      env: step.env ? { ...step.env } : undefined,
    })),
  };
}

function buildWorkflowName(selectedTemplates: TemplateMatch[], description: string): string {
  if (selectedTemplates.length === 1) {
    return `${selectedTemplates[0]!.name} workflow`;
  }

  if (description.length <= 72) {
    return toTitleCase(description);
  }

  return `${selectedTemplates.map((entry) => entry.name).join(' + ')} workflow`;
}

function suggestWorkflowFileName(description: string): string {
  const normalized = description
    .toLowerCase()
    .replace(/[^a-z0-9]+/gu, '-')
    .replace(/^-+|-+$/gu, '')
    .slice(0, 48);
  return `${normalized || 'workflow'}.yml`;
}

function renderWorkflow(
  workflow: WorkflowTemplate,
  description: string,
  selectedTemplateNames: string[],
): string {
  const lines: string[] = [
    '# Generated by iCopilot /actions',
    `# Description: ${description}`,
    `# Templates: ${selectedTemplateNames.join(', ')}`,
    `name: ${yamlScalar(workflow.name)}`,
    '',
    'on:',
  ];

  lines.push(...renderTriggers(workflow.triggers));
  lines.push('', 'jobs:');
  lines.push(...renderJobs(workflow.jobs));
  return lines.join('\n');
}

function renderTriggers(triggers: WorkflowTemplate['triggers']): string[] {
  const lines: string[] = [
    '  # Adjust branches, tags, or schedules to match your release strategy.',
  ];
  const orderedTriggers: TriggerName[] = [
    'push',
    'pull_request',
    'release',
    'workflow_dispatch',
    'schedule',
  ];

  for (const triggerName of orderedTriggers) {
    const config = triggers[triggerName];
    if (!config) continue;

    if (triggerName === 'workflow_dispatch') {
      lines.push('  workflow_dispatch:');
      continue;
    }

    if (triggerName === 'schedule') {
      lines.push('  schedule:');
      for (const cron of config.cron ?? []) {
        lines.push('    - cron: ' + yamlScalar(cron));
      }
      continue;
    }

    const hasBody = Boolean(
      (config.branches && config.branches.length > 0) ||
      (config.tags && config.tags.length > 0) ||
      (config.types && config.types.length > 0),
    );

    if (!hasBody) {
      lines.push(`  ${triggerName}:`);
      continue;
    }

    lines.push(`  ${triggerName}:`);
    if (config.branches?.length) {
      lines.push('    branches:');
      for (const branch of config.branches) {
        lines.push(`      - ${yamlScalar(branch)}`);
      }
    }
    if (config.tags?.length) {
      lines.push('    tags:');
      for (const tag of config.tags) {
        lines.push(`      - ${yamlScalar(tag)}`);
      }
    }
    if (config.types?.length) {
      lines.push('    types:');
      for (const type of config.types) {
        lines.push(`      - ${yamlScalar(type)}`);
      }
    }
  }

  return lines;
}

function renderJobs(jobs: Job[]): string[] {
  const usedIds = new Set<string>();
  const lines: string[] = [];

  for (const job of jobs) {
    const jobId = uniqueJobId(job.name, usedIds);
    lines.push(`  # ${job.name}`);
    lines.push(`  ${jobId}:`);
    lines.push(`    name: ${yamlScalar(job.name)}`);
    lines.push(`    runs-on: ${yamlScalar(job.runsOn)}`);

    if (job.needs?.length) {
      lines.push(
        `    needs: ${job.needs.length === 1 ? yamlScalar(job.needs[0]!) : `[${job.needs.map(yamlScalar).join(', ')}]`}`,
      );
    }

    if (job.permissions && Object.keys(job.permissions).length > 0) {
      lines.push('    permissions:');
      for (const [key, value] of Object.entries(job.permissions)) {
        lines.push(`      ${key}: ${yamlScalar(value)}`);
      }
    }

    if (job.env && Object.keys(job.env).length > 0) {
      lines.push('    env:');
      for (const [key, value] of Object.entries(job.env)) {
        lines.push(`      ${key}: ${yamlScalar(value)}`);
      }
    }

    lines.push('    steps:');
    for (const step of job.steps) {
      if (step.comment) {
        lines.push(`      # ${step.comment}`);
      }
      lines.push(...renderStep(step));
    }
  }

  return lines;
}

function renderStep(step: Step): string[] {
  const lines: string[] = ['      -'];

  if (step.name) lines.push(`        name: ${yamlScalar(step.name)}`);
  if (step.uses) lines.push(`        uses: ${yamlScalar(step.uses)}`);
  if (step.run) lines.push(`        run: ${yamlScalar(step.run)}`);
  if (step.shell) lines.push(`        shell: ${yamlScalar(step.shell)}`);

  if (step.with && Object.keys(step.with).length > 0) {
    lines.push('        with:');
    for (const [key, value] of Object.entries(step.with)) {
      lines.push(`          ${key}: ${yamlScalar(value)}`);
    }
  }

  if (step.env && Object.keys(step.env).length > 0) {
    lines.push('        env:');
    for (const [key, value] of Object.entries(step.env)) {
      lines.push(`          ${key}: ${yamlScalar(value)}`);
    }
  }

  return lines;
}

function yamlScalar(value: Scalar): string {
  const text = String(value);
  if (/^\$\{\{.+\}\}$/u.test(text)) return `'${text}'`;
  if (/^[A-Za-z0-9._/@:-]+$/u.test(text)) return text;
  return `'${text.replace(/'/gu, `''`)}'`;
}

function uniqueJobId(name: string, usedIds: Set<string>): string {
  const baseId =
    name
      .toLowerCase()
      .replace(/[^a-z0-9]+/gu, '_')
      .replace(/^_+|_+$/gu, '') || 'job';

  let candidate = baseId;
  let index = 2;
  while (usedIds.has(candidate)) {
    candidate = `${baseId}_${index}`;
    index += 1;
  }

  usedIds.add(candidate);
  return candidate;
}

function sliceJobSection(lines: string[], jobId: string): string[] {
  const start = lines.findIndex((line) => line === `  ${jobId}:`);
  if (start === -1) return [];

  const jobLines: string[] = [];
  for (let index = start; index < lines.length; index += 1) {
    const line = lines[index]!;
    if (index !== start && /^ {2}[A-Za-z0-9_-]+:\s*$/u.test(line)) {
      break;
    }
    jobLines.push(line);
  }

  return jobLines;
}

function toTitleCase(value: string): string {
  return value
    .split(/\s+/u)
    .filter(Boolean)
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(' ');
}
