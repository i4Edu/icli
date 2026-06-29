import fs from 'node:fs';
import path from 'node:path';
import { parseDocument } from 'yaml';

export interface CustomAgentDef {
  name: string;
  description: string;
  systemPrompt: string;
  model?: string;
  temperature?: number;
  tools?: string[];
  maxTokens?: number;
}

const AGENTS_DIR = path.join('.icopilot', 'agents');

let cachedAgents: CustomAgentDef[] = [];

export function loadCustomAgents(projectRoot: string): CustomAgentDef[] {
  const resolvedRoot = path.resolve(projectRoot);
  const agentsDir = path.join(resolvedRoot, AGENTS_DIR);
  fs.mkdirSync(agentsDir, { recursive: true });

  const agents = fs
    .readdirSync(agentsDir, { withFileTypes: true })
    .filter((entry) => entry.isFile() && /\.ya?ml$/i.test(entry.name))
    .sort((left, right) => left.name.localeCompare(right.name))
    .map((entry) => loadAgentFile(path.join(agentsDir, entry.name)));

  cachedAgents = agents;
  return agents.map(cloneAgent);
}

export function getCustomAgent(name: string): CustomAgentDef | undefined {
  const match =
    cachedAgents.find((agent) => agent.name === name) ??
    cachedAgents.find((agent) => agent.name.toLowerCase() === name.toLowerCase());
  return match ? cloneAgent(match) : undefined;
}

export function listCustomAgents(): CustomAgentDef[] {
  return cachedAgents.map(cloneAgent);
}

function loadAgentFile(filePath: string): CustomAgentDef {
  const raw = fs.readFileSync(filePath, 'utf8');
  const document = parseDocument(raw);
  if (document.errors.length > 0) {
    const [firstError] = document.errors;
    throw new Error(
      `Invalid YAML in ${path.relative(process.cwd(), filePath)}: ${firstError?.message ?? 'parse error'}`,
    );
  }

  return validateAgentDef(document.toJSON(), filePath);
}

function validateAgentDef(value: unknown, filePath: string): CustomAgentDef {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error(`${label(filePath)} must contain a YAML object`);
  }

  const record = value as Record<string, unknown>;
  const agent: CustomAgentDef = {
    name: requiredString(record.name, 'name', filePath),
    description: requiredString(record.description, 'description', filePath),
    systemPrompt: requiredString(record.systemPrompt, 'systemPrompt', filePath),
  };

  const model = optionalString(record.model, 'model', filePath);
  if (model) agent.model = model;

  if (record.temperature !== undefined) {
    agent.temperature = numberInRange(record.temperature, 'temperature', filePath, 0, 2);
  }

  if (record.tools !== undefined) {
    if (
      !Array.isArray(record.tools) ||
      record.tools.some((tool) => typeof tool !== 'string' || tool.trim().length === 0)
    ) {
      throw new Error(`${label(filePath)} field "tools" must be an array of non-empty strings`);
    }
    agent.tools = [...new Set(record.tools.map((tool) => tool.trim()))];
  }

  if (record.maxTokens !== undefined) {
    agent.maxTokens = positiveInteger(record.maxTokens, 'maxTokens', filePath);
  }

  return agent;
}

function requiredString(value: unknown, field: string, filePath: string): string {
  if (typeof value !== 'string' || value.trim().length === 0) {
    throw new Error(`${label(filePath)} field "${field}" must be a non-empty string`);
  }
  return value.trim();
}

function optionalString(value: unknown, field: string, filePath: string): string | undefined {
  if (value === undefined) return undefined;
  if (typeof value !== 'string' || value.trim().length === 0) {
    throw new Error(`${label(filePath)} field "${field}" must be a non-empty string`);
  }
  return value.trim();
}

function positiveInteger(value: unknown, field: string, filePath: string): number {
  if (typeof value !== 'number' || !Number.isInteger(value) || value < 1) {
    throw new Error(`${label(filePath)} field "${field}" must be a positive integer`);
  }
  return value;
}

function numberInRange(
  value: unknown,
  field: string,
  filePath: string,
  min: number,
  max: number,
): number {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < min || value > max) {
    throw new Error(
      `${label(filePath)} field "${field}" must be a number between ${min} and ${max}`,
    );
  }
  return value;
}

function cloneAgent(agent: CustomAgentDef): CustomAgentDef {
  return {
    ...agent,
    tools: agent.tools ? [...agent.tools] : undefined,
  };
}

function label(filePath: string): string {
  return path.relative(process.cwd(), filePath) || filePath;
}
