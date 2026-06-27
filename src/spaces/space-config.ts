import fs from 'node:fs';
import path from 'node:path';
import type { SpaceConfig } from './space.js';

export const DEFAULT_SPACE_CONFIG: SpaceConfig = {
  tools: [],
  contextFiles: [],
};

export const DEFAULT_SPACE_CONFIG_TEMPLATE = serializeSpaceConfig(DEFAULT_SPACE_CONFIG);

export function loadSpaceConfig(dir: string): SpaceConfig {
  const file = configPath(dir);
  if (!fs.existsSync(file)) return cloneSpaceConfig(DEFAULT_SPACE_CONFIG);

  try {
    const parsed = parseSpaceConfig(fs.readFileSync(file, 'utf8'));
    return {
      model: parsed.model,
      systemPrompt: parsed.systemPrompt,
      tools: parsed.tools ?? [],
      contextFiles: parsed.contextFiles ?? [],
      maxTokens: parsed.maxTokens,
    };
  } catch {
    return cloneSpaceConfig(DEFAULT_SPACE_CONFIG);
  }
}

export function saveSpaceConfig(dir: string, config: SpaceConfig): void {
  const file = configPath(dir);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, serializeSpaceConfig(config), 'utf8');
}

export function serializeSpaceConfig(config: SpaceConfig): string {
  const lines = [
    `model: ${formatScalar(config.model)}`,
    `systemPrompt: ${formatScalar(config.systemPrompt)}`,
    ...formatArray('tools', config.tools),
    ...formatArray('contextFiles', config.contextFiles),
    `maxTokens: ${typeof config.maxTokens === 'number' ? String(config.maxTokens) : ''}`,
  ];
  return `${lines.join('\n')}\n`;
}

function configPath(dir: string): string {
  return path.join(dir, '.icopilot', 'space.yaml');
}

function cloneSpaceConfig(config: SpaceConfig): SpaceConfig {
  return {
    model: config.model,
    systemPrompt: config.systemPrompt,
    tools: [...(config.tools ?? [])],
    contextFiles: [...(config.contextFiles ?? [])],
    maxTokens: config.maxTokens,
  };
}

function parseSpaceConfig(source: string): SpaceConfig {
  const result: SpaceConfig = cloneSpaceConfig(DEFAULT_SPACE_CONFIG);
  const lines = source.split(/\r?\n/);

  for (let index = 0; index < lines.length; index += 1) {
    const rawLine = lines[index];
    const line = rawLine.trim();
    if (!line || line.startsWith('#')) continue;

    const match = /^([A-Za-z][A-Za-z0-9]*):\s*(.*)$/.exec(line);
    if (!match) continue;

    const [, key, value] = match;
    switch (key) {
      case 'model':
        result.model = parseString(value);
        break;
      case 'systemPrompt':
        result.systemPrompt = parseString(value);
        break;
      case 'maxTokens':
        result.maxTokens = parseNumber(value);
        break;
      case 'tools':
      case 'contextFiles': {
        const { items, nextIndex } = parseArray(lines, index, value);
        result[key] = items;
        index = nextIndex;
        break;
      }
      default:
        break;
    }
  }

  return result;
}

function parseArray(
  lines: string[],
  index: number,
  inlineValue: string,
): { items: string[]; nextIndex: number } {
  const trimmed = inlineValue.trim();
  if (!trimmed) {
    const items: string[] = [];
    let nextIndex = index;
    for (let cursor = index + 1; cursor < lines.length; cursor += 1) {
      const line = lines[cursor];
      if (!line.trim() || line.trim().startsWith('#')) {
        nextIndex = cursor;
        continue;
      }
      if (!/^\s+-\s+/.test(line)) break;
      items.push(parseItem(line.replace(/^\s+-\s+/, '')));
      nextIndex = cursor;
    }
    return { items, nextIndex };
  }

  if (trimmed === '[]') return { items: [], nextIndex: index };
  if (trimmed.startsWith('[') && trimmed.endsWith(']')) {
    const inner = trimmed.slice(1, -1).trim();
    if (!inner) return { items: [], nextIndex: index };
    return {
      items: inner
        .split(',')
        .map((part) => parseItem(part))
        .filter((part) => part.length > 0),
      nextIndex: index,
    };
  }

  return { items: [parseItem(trimmed)], nextIndex: index };
}

function parseItem(value: string): string {
  return parseString(value) ?? '';
}

function parseString(value: string): string | undefined {
  const trimmed = value.trim();
  if (!trimmed || trimmed === 'null') return undefined;
  if (trimmed.startsWith('"') && trimmed.endsWith('"')) {
    try {
      return JSON.parse(trimmed) as string;
    } catch {
      return trimmed.slice(1, -1);
    }
  }
  if (trimmed.startsWith("'") && trimmed.endsWith("'")) {
    return trimmed.slice(1, -1).replace(/''/g, "'");
  }
  return trimmed;
}

function parseNumber(value: string): number | undefined {
  const trimmed = value.trim();
  if (!trimmed) return undefined;
  const parsed = Number(trimmed);
  return Number.isFinite(parsed) ? parsed : undefined;
}

function formatScalar(value: string | undefined): string {
  return typeof value === 'string' ? JSON.stringify(value) : '';
}

function formatArray(name: string, values: string[] | undefined): string[] {
  if (!values || values.length === 0) return [`${name}: []`];
  return [name + ':', ...values.map((value) => `  - ${JSON.stringify(value)}`)];
}
