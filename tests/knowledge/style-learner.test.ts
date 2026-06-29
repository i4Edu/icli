import fs from 'node:fs';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  StyleLearner,
  loadStyleProfile,
  loadStylePromptContext,
  resetStyleProfile,
  resolveStyleProfilePath,
} from '../../src/knowledge/style-learner.js';

let tmpRoot: string;
let tmpDir: string;

beforeEach(() => {
  tmpRoot = path.join(process.cwd(), '.vitest-style-learner-tmp');
  fs.mkdirSync(tmpRoot, { recursive: true });
  tmpDir = fs.mkdtempSync(path.join(tmpRoot, 'case-'));
});

afterEach(() => {
  fs.rmSync(tmpRoot, { recursive: true, force: true });
});

describe('StyleLearner', () => {
  it('analyzes project files and infers a style profile', () => {
    const fileA = path.join(tmpDir, 'alpha.ts');
    const fileB = path.join(tmpDir, 'beta.ts');

    fs.writeFileSync(
      fileA,
      [
        "import { readFileSync } from 'node:fs';",
        '',
        "import { join } from 'node:path';",
        '',
        '// line comment',
        'const userName = (firstName: string) => {',
        "  const message = 'hello';",
        '  return {',
        '    userName,',
        '    firstName,',
        '  };',
        '};',
        '',
      ].join('\n'),
      'utf8',
    );
    fs.writeFileSync(
      fileB,
      [
        "import { describe } from 'vitest';",
        '',
        'const anotherValue = () => {',
        "  const greeting = 'hi';",
        '  return [',
        '    greeting,',
        '    anotherValue,',
        '  ];',
        '};',
        '',
      ].join('\n'),
      'utf8',
    );

    const learner = new StyleLearner();
    const profile = learner.analyze([fileA, fileB]);

    expect(profile).toMatchObject({
      indentation: '2 spaces',
      quotes: 'single',
      semicolons: 'always',
      trailingComma: 'always',
      namingConvention: 'camelCase',
      importStyle: 'named imports, grouped',
      functionStyle: 'arrow',
      commentStyle: 'line',
      maxLineLength: 80,
    });
    expect(learner.toPromptContext()).toContain('Follow the project style profile');
    expect(learner.toPromptContext()).toContain('Indentation: 2 spaces');
  });

  it('supports incremental learning and persistence', () => {
    const profilePath = resolveStyleProfilePath(tmpDir);
    const firstFile = path.join(tmpDir, 'first.ts');
    const secondFile = path.join(tmpDir, 'second.ts');

    fs.writeFileSync(
      firstFile,
      ['class UserName {', '  static buildProfile() {', '    return "Ada";', '  }', '}', ''].join(
        '\n',
      ),
      'utf8',
    );
    fs.writeFileSync(
      secondFile,
      ['function buildProfile() {', "  return 'Grace';", '}', ''].join('\n'),
      'utf8',
    );

    const learner = new StyleLearner();
    learner.learnFromFile(firstFile);
    learner.save(profilePath);

    const reloaded = new StyleLearner();
    reloaded.load(profilePath);
    expect(reloaded.getProfile().quotes).toBe('double');
    expect(reloaded.getProfile().namingConvention).toBe('PascalCase');

    reloaded.learnFromFile(secondFile);
    reloaded.save(profilePath);

    expect(loadStyleProfile(tmpDir)).toMatchObject({
      quotes: 'double',
      functionStyle: 'function',
    });
    expect(loadStylePromptContext(tmpDir)).toContain('Quotes: double');
    expect(resetStyleProfile(tmpDir)).toBe(true);
    expect(loadStyleProfile(tmpDir)).toBeNull();
  });
});
