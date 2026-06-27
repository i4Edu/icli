import fs from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { diagramCommand, generateDiagram } from '../../src/commands/diagram-cmd.js';

let fixtureDir: string;

beforeEach(() => {
  fixtureDir = path.join(process.cwd(), 'tests', '.runtime-diagram', randomUUID());
  fs.mkdirSync(fixtureDir, { recursive: true });
});

afterEach(() => {
  fs.rmSync(fixtureDir, { recursive: true, force: true });
});

function writeFixture(relativePath: string, content: string): void {
  const filePath = path.join(fixtureDir, relativePath);
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, content);
}

describe('diagram-cmd', () => {
  it('generates an architecture diagram for project modules', () => {
    writeFixture(
      'src/index.ts',
      [
        "import { start } from './app/start.js';",
        "import { logger } from './shared/logger.js';",
        'export function main() {',
        '  logger();',
        '  start();',
        '}',
      ].join('\n'),
    );
    writeFixture(
      'src/app/start.ts',
      [
        "import { logger } from '../shared/logger.js';",
        'export function start() {',
        '  logger();',
        '}',
      ].join('\n'),
    );
    writeFixture('src/shared/logger.ts', 'export function logger() {}\n');

    const diagram = generateDiagram(fixtureDir, { type: 'architecture' });

    expect(diagram).toContain('```mermaid');
    expect(diagram).toContain('graph TD');
    expect(diagram).toContain('src/index.ts');
    expect(diagram).toContain('src/app');
    expect(diagram).toContain('src/shared');
    expect(diagram).toContain('-->');
  });

  it('generates a dependency graph between files', () => {
    writeFixture('src/index.ts', "import { run } from './run.js';\nrun();\n");
    writeFixture('src/run.ts', "import { log } from './util/log.js';\nexport function run() { log(); }\n");
    writeFixture('src/util/log.ts', 'export function log() {}\n');

    const diagram = generateDiagram(fixtureDir, { type: 'deps' });

    expect(diagram).toContain('graph LR');
    expect(diagram).toContain('src/index.ts');
    expect(diagram).toContain('src/run.ts');
    expect(diagram).toContain('src/util/log.ts');
  });

  it('generates a class hierarchy diagram scoped to a file', () => {
    writeFixture('src/models/base.ts', 'export class BaseModel {}\n');
    writeFixture(
      'src/models/user.ts',
      [
        "import { BaseModel } from './base.js';",
        'export class UserModel extends BaseModel {}',
      ].join('\n'),
    );

    const diagram = generateDiagram(fixtureDir, { type: 'classes', scope: 'src/models/user.ts' });

    expect(diagram).toContain('classDiagram');
    expect(diagram).toContain('UserModel');
    expect(diagram).toContain('BaseModel (external)');
    expect(diagram).toContain('<|--');
  });

  it('generates a function call flow for a requested function', () => {
    writeFixture(
      'src/index.ts',
      [
        'export function main() {',
        '  prepare();',
        '  render();',
        '}',
        'function prepare() {',
        '  format();',
        '}',
        'function render() {}',
        'function format() {}',
      ].join('\n'),
    );

    const diagram = generateDiagram(fixtureDir, { type: 'flow', scope: 'main' });

    expect(diagram).toContain('flowchart TD');
    expect(diagram).toContain('main');
    expect(diagram).toContain('prepare');
    expect(diagram).toContain('render');
    expect(diagram).toContain('format');
    expect(diagram).toContain('-->');
  });

  it('limits nodes and summarizes the remainder', () => {
    for (let index = 0; index < 24; index += 1) {
      const current = `src/m${index}/index.ts`;
      const next = index < 23 ? `../m${index + 1}/index.js` : null;
      writeFixture(
        current,
        next
          ? `import '../m${index + 1}/index.js';\nexport const value${index} = ${index};\n`
          : `export const value${index} = ${index};\n`,
      );
    }

    const diagram = generateDiagram(fixtureDir, { type: 'architecture' });

    expect(diagram).toContain('other modules');
    expect(diagram).toContain('omitted for readability');
  });

  it('routes slash-style arguments to the requested diagram type', () => {
    writeFixture('src/index.ts', 'export class Root {}\n');

    expect(diagramCommand([], fixtureDir)).toContain('graph TD');
    expect(diagramCommand(['classes', 'src/index.ts'], fixtureDir)).toContain('classDiagram');
    expect(diagramCommand(['flow', 'missingFunction'], fixtureDir)).toContain('No function flow found');
    expect(diagramCommand(['wat'], fixtureDir)).toContain('usage: /diagram');
  });
});
