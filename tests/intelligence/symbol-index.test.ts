import fs from 'node:fs';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { SymbolIndex } from '../../src/intelligence/symbol-index.js';

let workspace: string;

beforeEach(() => {
  workspace = path.join(
    process.cwd(),
    '.test-workspaces',
    `symbol-index-${process.pid}-${Date.now()}-${Math.random().toString(16).slice(2)}`,
  );

  fs.mkdirSync(path.join(workspace, 'src'), { recursive: true });

  fs.writeFileSync(
    path.join(workspace, 'src', 'sample.ts'),
    [
      'export function greetUser(name: string): string {',
      '  return `Hello ${name}`;',
      '}',
      '',
      'function localHelper(): string {',
      "  return 'local';",
      '}',
      '',
      'export class Greeter {',
      '  greet(name: string): string {',
      '    return this.compose(name);',
      '  }',
      '',
      '  private compose(name: string): string {',
      '    return `Hello ${name}`;',
      '  }',
      '}',
      '',
      'export interface PublicShape {',
      '  name: string;',
      '}',
      '',
      'interface InternalShape {',
      '  hidden: boolean;',
      '}',
      '',
      'export type PublicType = PublicShape & { active: boolean };',
      'type InternalType = InternalShape | null;',
      '',
      'export enum PublicState {',
      "  Ready = 'ready',",
      '}',
      '',
      'const localValue = 1;',
      'export const publicValue = 2;',
      'export let publicCount = 3;',
      '',
    ].join('\n'),
    'utf8',
  );

  fs.writeFileSync(
    path.join(workspace, 'src', 'helper.js'),
    [
      'export function greetManager(name) {',
      '  return `Hi ${name}`;',
      '}',
      '',
      'class Helper {',
      '  buildMessage(name) {',
      '    return name.toUpperCase();',
      '  }',
      '}',
      '',
    ].join('\n'),
    'utf8',
  );

  fs.writeFileSync(
    path.join(workspace, 'src', 'ignored.ts'),
    'export function ignoredThing(): string { return "ignored"; }\n',
    'utf8',
  );
});

afterEach(() => {
  fs.rmSync(workspace, { recursive: true, force: true });
});

describe('SymbolIndex', () => {
  it('builds, searches, filters, and persists a symbol index', async () => {
    const index = new SymbolIndex();
    await index.build(workspace);

    const cachePath = path.join(workspace, '.icopilot', 'symbol-index.json');
    expect(fs.existsSync(cachePath)).toBe(true);

    const sampleSymbols = index.getByFile(path.join(workspace, 'src', 'sample.ts'));
    expect(sampleSymbols.map((symbol) => symbol.name)).toEqual(
      expect.arrayContaining([
        'greetUser',
        'localHelper',
        'Greeter',
        'greet',
        'compose',
        'PublicShape',
        'InternalShape',
        'PublicType',
        'InternalType',
        'PublicState',
        'localValue',
        'publicValue',
        'publicCount',
      ]),
    );

    expect(index.getByKind('method').map((symbol) => symbol.name)).toEqual(
      expect.arrayContaining(['greet', 'compose', 'buildMessage']),
    );

    expect(index.getExported().map((symbol) => symbol.name)).toEqual(
      expect.arrayContaining([
        'greetUser',
        'Greeter',
        'PublicShape',
        'PublicType',
        'PublicState',
        'publicValue',
        'publicCount',
        'greetManager',
      ]),
    );
    expect(index.getExported().map((symbol) => symbol.name)).not.toContain('localHelper');

    const greetMethod = sampleSymbols.find(
      (symbol) => symbol.name === 'greet' && symbol.kind === 'method',
    );
    const composeMethod = sampleSymbols.find(
      (symbol) => symbol.name === 'compose' && symbol.kind === 'method',
    );
    expect(greetMethod?.line).toBe(10);
    expect(composeMethod?.line).toBe(14);

    expect(index.search('grtmgr')[0]?.name).toBe('greetManager');

    const customPath = path.join(workspace, 'cache', 'symbols.json');
    index.save(customPath);

    const loaded = new SymbolIndex();
    loaded.load(customPath);
    expect(loaded.getExported().map((symbol) => symbol.name)).toEqual(
      index.getExported().map((symbol) => symbol.name),
    );
  });

  it('respects extensions, exclusions, and includePrivate filtering', async () => {
    const index = new SymbolIndex();
    await index.build(workspace, {
      extensions: ['.ts'],
      exclude: ['**/ignored.ts'],
      includePrivate: false,
    });

    const names = index.search('g').map((symbol) => symbol.name);

    expect(names).toContain('greetUser');
    expect(names).toContain('Greeter');
    expect(names).toContain('greet');
    expect(names).not.toContain('greetManager');
    expect(names).not.toContain('ignoredThing');
    expect(names).not.toContain('localHelper');
    expect(names).not.toContain('compose');
    expect(names).not.toContain('InternalShape');
    expect(names).not.toContain('InternalType');
    expect(names).not.toContain('localValue');
  });
});
