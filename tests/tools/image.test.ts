import fs from 'node:fs';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { config } from '../../src/config.js';
import { IMAGE_EXTENSIONS, readImage } from '../../src/tools/image.js';

const PNG_BASE64 =
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aZ1EAAAAASUVORK5CYII=';

let tempDir: string;
let originalCwd: string;

beforeEach(() => {
  tempDir = fs.mkdtempSync(path.join(process.cwd(), 'image-tool-test-'));
  originalCwd = config.cwd;
  config.cwd = tempDir;
});

afterEach(() => {
  config.cwd = originalCwd;
  fs.rmSync(tempDir, { recursive: true, force: true });
});

describe('readImage', () => {
  it('reads a valid PNG and returns metadata', () => {
    const file = path.join(tempDir, 'tiny.png');
    fs.writeFileSync(file, Buffer.from(PNG_BASE64, 'base64'));

    const result = readImage({ path: 'tiny.png' });

    expect('error' in result).toBe(false);
    if ('error' in result) return;
    expect(result.path).toBe(path.resolve(tempDir, 'tiny.png'));
    expect(result.mimeType).toBe('image/png');
    expect(result.width).toBe(1);
    expect(result.height).toBe(1);
    expect(result.sizeBytes).toBe(fs.statSync(file).size);
    expect(result.base64).toBe(PNG_BASE64);
  });

  it('returns an error for a non-existent file', () => {
    expect(readImage({ path: 'missing.png' })).toEqual({
      error: 'file not found: missing.png',
    });
  });

  it('returns an error for an unsupported extension', () => {
    fs.writeFileSync(path.join(tempDir, 'note.bmp'), 'not-an-image');

    expect(readImage({ path: 'note.bmp' })).toEqual({
      error: 'unsupported image extension: .bmp',
    });
  });

  it('returns an error for files larger than 10MB', () => {
    const file = path.join(tempDir, 'oversized.png');
    fs.writeFileSync(file, Buffer.alloc(10 * 1024 * 1024 + 1, 0));

    expect(readImage({ path: 'oversized.png' })).toEqual({
      error: 'image exceeds 10MB limit: oversized.png',
    });
  });

  it('exports the supported image extensions', () => {
    expect(IMAGE_EXTENSIONS).toEqual(['.png', '.jpg', '.jpeg', '.gif', '.webp', '.svg']);
  });
});
