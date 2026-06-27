import fs from 'node:fs';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { confirm } from '@inquirer/prompts';
import { config } from '../../src/config.js';
import { dispatchTool, TOOL_SCHEMAS } from '../../src/tools/registry.js';
import {
  applyMultiEdit,
  planMultiEdit,
  rollbackMultiEdit,
  type MultiEditPlan,
} from '../../src/tools/multi-edit.js';
import { toolMemory } from '../../src/tools/memory.js';

vi.mock('@inquirer/prompts', () => ({ confirm: vi.fn() }));

let tempRoot: string;
let workspaceDir: string;
let originalCwd: string;
let originalQuiet: boolean;
let originalJsonOutput: boolean;
let originalAutoApprove: boolean;
let stdoutSpy: ReturnType<typeof vi.spyOn>;

beforeEach(() => {
  tempRoot = path.join(process.cwd(), 'tests', '.tmp');
  fs.mkdirSync(tempRoot, { recursive: true });
  workspaceDir = fs.mkdtempSync(path.join(tempRoot, 'multi-edit-'));

  originalCwd = config.cwd;
  originalQuiet = config.quiet;
  originalJsonOutput = config.jsonOutput;
  originalAutoApprove = config.autoApprove;

  config.cwd = workspaceDir;
  config.quiet = true;
  config.jsonOutput = false;
  config.autoApprove = false;

  stdoutSpy = vi.spyOn(process.stdout, 'write').mockImplementation(() => true);
  toolMemory.allowWritePath.clear();
  vi.mocked(confirm).mockReset();
});

afterEach(() => {
  stdoutSpy.mockRestore();
  config.cwd = originalCwd;
  config.quiet = originalQuiet;
  config.jsonOutput = originalJsonOutput;
  config.autoApprove = originalAutoApprove;
  fs.rmSync(workspaceDir, { recursive: true, force: true });
});

describe('multi-edit', () => {
  it('builds a unified preview across all files', () => {
    fs.writeFileSync(path.join(workspaceDir, 'one.txt'), 'alpha\nbeta\n', 'utf8');
    fs.writeFileSync(path.join(workspaceDir, 'two.txt'), 'gamma\ndelta\n', 'utf8');

    const preview = planMultiEdit({
      description: 'Update two files',
      rollbackable: true,
      files: [
        { file: 'one.txt', edits: [{ oldText: 'beta', newText: 'BETA' }] },
        { file: 'two.txt', edits: [{ oldText: 'delta', newText: 'DELTA' }] },
      ],
    });

    expect(preview.totalChanges).toBe(2);
    expect(preview.files).toHaveLength(2);
    expect(preview.files[0]).toMatchObject({ path: 'one.txt' });
    expect(preview.files[0]?.diff).toContain('-beta');
    expect(preview.files[0]?.diff).toContain('+BETA');
    expect(preview.files[1]?.diff).toContain('+DELTA');
  });

  it('applies edits atomically and supports manual rollback', () => {
    fs.writeFileSync(path.join(workspaceDir, 'one.txt'), 'alpha\nbeta\n', 'utf8');
    fs.writeFileSync(path.join(workspaceDir, 'two.txt'), 'gamma\ndelta\n', 'utf8');

    const result = applyMultiEdit({
      description: 'Apply coordinated edit',
      rollbackable: true,
      files: [
        { file: 'one.txt', edits: [{ oldText: 'beta', newText: 'BETA' }] },
        { file: 'two.txt', edits: [{ oldText: 'delta', newText: 'DELTA' }] },
      ],
    });

    expect(result).toEqual({ success: true, applied: ['one.txt', 'two.txt'] });
    expect(fs.readFileSync(path.join(workspaceDir, 'one.txt'), 'utf8')).toBe('alpha\nBETA\n');
    expect(fs.readFileSync(path.join(workspaceDir, 'two.txt'), 'utf8')).toBe('gamma\nDELTA\n');

    rollbackMultiEdit(result);

    expect(fs.readFileSync(path.join(workspaceDir, 'one.txt'), 'utf8')).toBe('alpha\nbeta\n');
    expect(fs.readFileSync(path.join(workspaceDir, 'two.txt'), 'utf8')).toBe('gamma\ndelta\n');
    expect(result.applied).toEqual([]);
  });

  it('restores earlier writes when a later file fails', () => {
    const firstPath = path.join(workspaceDir, 'one.txt');
    const secondPath = path.join(workspaceDir, 'two.txt');

    fs.writeFileSync(firstPath, 'alpha\nbeta\n', 'utf8');
    fs.writeFileSync(secondPath, 'gamma\ndelta\n', 'utf8');

    const originalWriteFileSync = fs.writeFileSync.bind(fs);
    const writeSpy = vi.spyOn(fs, 'writeFileSync').mockImplementation(((target, data, options) => {
      if (String(target) === secondPath) {
        throw new Error('simulated write failure');
      }
      return originalWriteFileSync(target, data as string, options as BufferEncoding);
    }) as typeof fs.writeFileSync);

    const result = applyMultiEdit({
      description: 'Fail after first write',
      rollbackable: true,
      files: [
        { file: 'one.txt', edits: [{ oldText: 'beta', newText: 'BETA' }] },
        { file: 'two.txt', edits: [{ oldText: 'delta', newText: 'DELTA' }] },
      ],
    });

    writeSpy.mockRestore();

    expect(result.success).toBe(false);
    expect(result.applied).toEqual([]);
    expect(result.failed).toEqual([{ file: 'two.txt', error: 'simulated write failure' }]);
    expect(fs.readFileSync(firstPath, 'utf8')).toBe('alpha\nbeta\n');
    expect(fs.readFileSync(secondPath, 'utf8')).toBe('gamma\ndelta\n');
  });

  it('registers the multi_edit tool and runs it through the registry', async () => {
    fs.writeFileSync(path.join(workspaceDir, 'one.txt'), 'alpha\nbeta\n', 'utf8');

    vi.mocked(confirm).mockResolvedValueOnce(true).mockResolvedValueOnce(false);

    const parsed = JSON.parse(
      await dispatchTool('multi_edit', {
        description: 'Registry-driven edit',
        rollbackable: true,
        files: [{ file: 'one.txt', edits: [{ oldText: 'beta', newText: 'BETA' }] }],
      }),
    ) as { success: boolean; applied: string[]; preview: { totalChanges: number } };

    expect(TOOL_SCHEMAS.some((schema) => schema.function.name === 'multi_edit')).toBe(true);
    expect(parsed.success).toBe(true);
    expect(parsed.applied).toEqual(['one.txt']);
    expect(parsed.preview.totalChanges).toBe(1);
    expect(fs.readFileSync(path.join(workspaceDir, 'one.txt'), 'utf8')).toBe('alpha\nBETA\n');
    expect(confirm).toHaveBeenNthCalledWith(1, {
      message: 'Apply all patches?',
      default: false,
    });
  });

  it('rejects ambiguous replacements', () => {
    fs.writeFileSync(path.join(workspaceDir, 'one.txt'), 'beta\nbeta\n', 'utf8');

    expect(() =>
      planMultiEdit({
        description: 'Ambiguous edit',
        rollbackable: true,
        files: [{ file: 'one.txt', edits: [{ oldText: 'beta', newText: 'BETA' }] }],
      }),
    ).toThrow(/matched multiple locations/);
  });
});
