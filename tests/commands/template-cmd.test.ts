import { describe, expect, it } from 'vitest';
import {
  BUILT_IN_TEMPLATES,
  listTemplates,
  previewTemplate,
} from '../../src/commands/template-cmd.js';

describe('template-cmd', () => {
  it('listTemplates returns all built-in template names', () => {
    const output = listTemplates();

    for (const template of BUILT_IN_TEMPLATES) {
      expect(output).toContain(template.name);
      expect(output).toContain(template.description);
    }
  });

  it('previewTemplate shows files for a valid template', () => {
    const output = previewTemplate('express-api');

    expect(output).toContain('Template: express-api');
    expect(output).toContain('src/');
    expect(output).toContain('index.ts');
    expect(output).toContain('routes/');
    expect(output).toContain('middleware/');
    expect(output).toContain('error.ts');
  });

  it('previewTemplate reports unknown templates', () => {
    const output = previewTemplate('missing-template');

    expect(output).toContain('Unknown template: missing-template');
    expect(output).toContain('node-ts');
  });

  it('BUILT_IN_TEMPLATES have valid structure', () => {
    const names = new Set<string>();

    for (const template of BUILT_IN_TEMPLATES) {
      expect(template.name).toBeTruthy();
      expect(template.description).toBeTruthy();
      expect(Array.isArray(template.files)).toBe(true);
      expect(template.files.length).toBeGreaterThan(0);
      expect(names.has(template.name)).toBe(false);
      names.add(template.name);

      const paths = new Set<string>();
      for (const file of template.files) {
        expect(file.path).toBeTruthy();
        expect(file.content).toBeTypeOf('string');
        expect(paths.has(file.path)).toBe(false);
        paths.add(file.path);
      }
    }
  });
});
