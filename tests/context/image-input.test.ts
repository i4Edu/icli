import fs from 'node:fs';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  buildImageContent,
  detectImagePaths,
  encodeImageToBase64,
  isVisionCapableModel,
} from '../../src/context/image-input.js';

describe('image input helpers', () => {
  let tmpRoot: string;
  let tmpDir: string;

  beforeEach(() => {
    tmpRoot = path.join(process.cwd(), '.vitest-image-input-tmp');
    fs.mkdirSync(tmpRoot, { recursive: true });
    tmpDir = fs.mkdtempSync(path.join(tmpRoot, 'case-'));
  });

  afterEach(() => {
    fs.rmSync(tmpRoot, { recursive: true, force: true });
  });

  it('detects quoted and unquoted image paths', () => {
    const windowsPath = 'C:\\Users\\demo\\Pictures\\capture.PNG';
    const message = [
      'Review ./assets/mockup.png and ../shots/demo.webp.',
      `Also inspect "${path.join(tmpDir, 'diagram image.svg')}" and ${windowsPath}.`,
      'Ignore https://example.com/logo.png and notes.txt.',
    ].join(' ');

    expect(detectImagePaths(message)).toEqual([
      './assets/mockup.png',
      '../shots/demo.webp',
      path.join(tmpDir, 'diagram image.svg'),
      windowsPath,
    ]);
  });

  it('encodes images to base64 with the correct mime type', () => {
    const filePath = path.join(tmpDir, 'sample.png');
    fs.writeFileSync(filePath, Buffer.from('hello image'), 'utf8');

    expect(encodeImageToBase64(filePath)).toEqual({
      base64: Buffer.from('hello image').toString('base64'),
      mimeType: 'image/png',
    });
  });

  it('detects vision-capable models', () => {
    expect(isVisionCapableModel('gpt-4o-mini')).toBe(true);
    expect(isVisionCapableModel('gpt-4-turbo')).toBe(true);
    expect(isVisionCapableModel('claude-3-5-sonnet-latest')).toBe(true);
    expect(isVisionCapableModel('gpt-3.5-turbo')).toBe(false);
    expect(isVisionCapableModel('llama3.2')).toBe(false);
  });

  it('builds OpenAI image_url content parts', () => {
    const pngPath = path.join(tmpDir, 'first.png');
    const jpgPath = path.join(tmpDir, 'second.jpg');
    fs.writeFileSync(pngPath, Buffer.from('png-bytes'));
    fs.writeFileSync(jpgPath, Buffer.from('jpg-bytes'));

    expect(buildImageContent([pngPath, jpgPath])).toEqual([
      {
        type: 'image_url',
        image_url: {
          url: `data:image/png;base64,${Buffer.from('png-bytes').toString('base64')}`,
        },
      },
      {
        type: 'image_url',
        image_url: {
          url: `data:image/jpeg;base64,${Buffer.from('jpg-bytes').toString('base64')}`,
        },
      },
    ]);
  });
});
