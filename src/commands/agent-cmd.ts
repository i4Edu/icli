import path from 'node:path';
import { theme } from '../ui/theme.js';

export type AgentType = 'explore' | 'task' | 'review' | 'plan';

export interface AgentConfig {
  type: AgentType;
  systemPrompt: string;
  model?: string;
  maxTokens?: number;
}

export interface AgentResult {
  type: AgentType;
  output: string;
  tokensUsed: number;
  durationMs: number;
}

const BUILT_IN_AGENT_CONFIGS: Record<AgentType, AgentConfig> = {
  explore: {
    type: 'explore',
    systemPrompt:
      'You are a codebase exploration agent. Analyze code structure, find relevant files, explain architecture. Use grep/glob tools to search. Be concise and factual.',
  },
  task: {
    type: 'task',
    systemPrompt:
      'You are a task execution agent. Run commands, report results concisely. On success: brief summary. On failure: full error output.',
  },
  review: {
    type: 'review',
    systemPrompt:
      'You are a code review agent. Focus only on real bugs, security issues, and logic errors. Never comment on style. Be extremely concise.',
  },
  plan: {
    type: 'plan',
    systemPrompt:
      "You are a planning agent. Break down the user's goal into numbered implementation steps. Each step should be actionable and specific.",
  },
};

export function getAgentConfig(type: AgentType): AgentConfig {
  return { ...BUILT_IN_AGENT_CONFIGS[type] };
}

export function buildAgentPrompt(type: AgentType, query: string, cwd: string): string {
  const config = getAgentConfig(type);
  const trimmedQuery = query.trim() || defaultQuery(type);

  return [
    config.systemPrompt,
    '',
    'Project context:',
    `- Current working directory: ${cwd}`,
    `- Project folder name: ${path.basename(cwd) || cwd}`,
    `- Agent type: ${type}`,
    '',
    'Task:',
    trimmedQuery,
  ].join('\n');
}

export function formatAgentResult(result: AgentResult): string {
  const metrics = theme.dim(`${result.tokensUsed} tokens • ${result.durationMs}ms`);
  return `${theme.badge(result.type.toUpperCase())} ${metrics}\n${result.output}\n`;
}

export function agentCommand(args: string[], cwd: string): string {
  const [subcommand, ...rest] = args;

  if (!subcommand) return usage();
  if (subcommand.toLowerCase() === 'list') return listAgents();

  if (!isAgentType(subcommand)) {
    return `${theme.warn(`unknown agent subcommand: ${subcommand}`)}\n${usage()}`;
  }

  const startedAt = Date.now();
  const query = normalizeQuery(subcommand, rest);
  const prompt = buildAgentPrompt(subcommand, query, cwd);
  const result: AgentResult = {
    type: subcommand,
    output: prompt,
    tokensUsed: estimateTokens(prompt),
    durationMs: Math.max(0, Date.now() - startedAt),
  };
  return formatAgentResult(result);
}

function usage(): string {
  return [
    theme.brand('Agent command'),
    '  /agent explore <question>          delegate repository exploration',
    '  /agent task <command-description>  delegate task execution',
    '  /agent review [target]             delegate code review (default: staged changes)',
    '  /agent plan <goal>                 delegate planning',
    '  /agent list                        show available agents',
    '',
  ].join('\n');
}

function listAgents(): string {
  const lines = (Object.keys(BUILT_IN_AGENT_CONFIGS) as AgentType[]).map((type) => {
    const config = getAgentConfig(type);
    return `  ${theme.ok(type)}  ${theme.dim(`- ${config.systemPrompt}`)}`;
  });
  return `${theme.brand('Available agents')}\n${lines.join('\n')}\n`;
}

function isAgentType(value: string): value is AgentType {
  return value === 'explore' || value === 'task' || value === 'review' || value === 'plan';
}

function normalizeQuery(type: AgentType, args: string[]): string {
  const query = args.join(' ').trim();
  if (query) return query;
  return defaultQuery(type);
}

function defaultQuery(type: AgentType): string {
  switch (type) {
    case 'explore':
      return 'Explore the current codebase and summarize the most relevant files and architecture.';
    case 'task':
      return 'Run the requested task in the current project and report the outcome.';
    case 'review':
      return 'Review the staged changes for bugs, security issues, and logic errors.';
    case 'plan':
      return "Break down the user's goal into an actionable implementation plan.";
  }
}

function estimateTokens(text: string): number {
  return Math.max(1, Math.ceil(text.trim().length / 4));
}
