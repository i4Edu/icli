import fs from 'node:fs';
import path from 'node:path';
import { theme } from '../ui/theme.js';
import { ROLES_CONFIG_FILE, renderRolesConfig } from '../security/roles.js';

export interface InitResult {
  created: string[];
  skipped: string[];
  cwd: string;
}

const POLICY_FILE = '.icopilot/policy.json';
const MEMORY_FILE = '.icopilot/memory.md';
const TEAM_MEMORY_FILE = '.icopilot/team-memory.md';
const ROLES_FILE = ROLES_CONFIG_FILE;
const AGENTS_DIR = '.icopilot/agents/';
const CONFIG_DIR = '.icopilot/';

const DEFAULT_POLICY = {
  allowShell: true,
  allowWrite: true,
  denyTools: [] as string[],
};

const MEMORY_TEMPLATE =
  '<!-- Project memory: add notes the AI should always know about this project -->\n';
const TEAM_MEMORY_TEMPLATE = `# Team memory

<!-- Shared team memory for conventions, decisions, tips, and warnings. -->
`;

export function initProject(cwd: string, opts?: { force?: boolean }): InitResult {
  const force = opts?.force === true;
  const configDir = path.join(cwd, '.icopilot');
  const agentsDir = path.join(configDir, 'agents');
  const policyPath = path.join(configDir, 'policy.json');
  const memoryPath = path.join(configDir, 'memory.md');
  const teamMemoryPath = path.join(configDir, 'team-memory.md');
  const rolesPath = path.join(configDir, 'roles.yaml');

  const created: string[] = [];
  const skipped: string[] = [];

  if (!fs.existsSync(configDir)) {
    fs.mkdirSync(configDir, { recursive: true });
    created.push(CONFIG_DIR);
  } else {
    skipped.push(CONFIG_DIR);
  }

  if (!fs.existsSync(agentsDir)) {
    fs.mkdirSync(agentsDir, { recursive: true });
    created.push(AGENTS_DIR);
  } else {
    skipped.push(AGENTS_DIR);
  }

  writeProjectFile(
    policyPath,
    `${JSON.stringify(DEFAULT_POLICY, null, 2)}\n`,
    POLICY_FILE,
    force,
    created,
    skipped,
  );
  writeProjectFile(memoryPath, MEMORY_TEMPLATE, MEMORY_FILE, force, created, skipped);
  writeProjectFile(teamMemoryPath, TEAM_MEMORY_TEMPLATE, TEAM_MEMORY_FILE, force, created, skipped);
  writeProjectFile(rolesPath, renderRolesConfig(), ROLES_FILE, force, created, skipped);

  return { created, skipped, cwd };
}

export function formatInitResult(result: InitResult): string {
  const lines = [
    `${theme.brand('Project initialized')} ${theme.dim(result.cwd)}`,
    '',
    formatSection('Created', result.created, theme.ok),
    formatSection('Skipped', result.skipped, theme.warn),
  ];

  return `${lines.join('\n')}\n`;
}

function writeProjectFile(
  filePath: string,
  contents: string,
  label: string,
  force: boolean,
  created: string[],
  skipped: string[],
): void {
  if (fs.existsSync(filePath) && !force) {
    skipped.push(label);
    return;
  }

  fs.writeFileSync(filePath, contents, 'utf8');
  created.push(label);
}

function formatSection(title: string, entries: string[], color: (text: string) => string): string {
  if (entries.length === 0) {
    return `  ${color(title)}  ${theme.dim('none')}`;
  }

  return [`  ${color(title)}`, ...entries.map((entry) => `    ${theme.hl(entry)}`)].join('\n');
}
