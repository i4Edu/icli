import fs from 'node:fs';
import path from 'node:path';
import type { ChatCompletionTool } from 'openai/resources/chat/completions';
import { config } from '../config.js';

export interface ImageArgs {
  path: string;
  maxWidth?: number;
}

export interface ImageInfo {
  path: string;
  mimeType: string;
  width?: number;
  height?: number;
  sizeBytes: number;
  base64: string;
}

export const IMAGE_EXTENSIONS: string[] = ['.png', '.jpg', '.jpeg', '.gif', '.webp', '.svg'];

const MAX_IMAGE_BYTES = 10 * 1024 * 1024;

const MIME_TYPES: Record<string, string> = {
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
  '.svg': 'image/svg+xml',
};

export function readImage(args: ImageArgs): ImageInfo | { error: string } {
  try {
    const abs = path.resolve(config.cwd, args.path);
    const ext = path.extname(abs).toLowerCase();

    if (!IMAGE_EXTENSIONS.includes(ext)) {
      return { error: `unsupported image extension: ${ext || '(none)'}` };
    }

    if (!fs.existsSync(abs)) {
      return { error: `file not found: ${args.path}` };
    }

    const stat = fs.statSync(abs);
    if (!stat.isFile()) {
      return { error: `not a file: ${args.path}` };
    }
    if (stat.size > MAX_IMAGE_BYTES) {
      return { error: `image exceeds 10MB limit: ${args.path}` };
    }

    const buffer = fs.readFileSync(abs);
    const dimensions = getDimensions(buffer, ext);

    return {
      path: abs,
      mimeType: MIME_TYPES[ext],
      width: dimensions?.width,
      height: dimensions?.height,
      sizeBytes: stat.size,
      base64: buffer.toString('base64'),
    };
  } catch (e: any) {
    return { error: e?.message || String(e) };
  }
}

export const DESCRIBE_IMAGE_SCHEMA: ChatCompletionTool = {
  type: 'function',
  function: {
    name: 'describe_image',
    description: 'Read an image file and return its base64 content for visual analysis',
    parameters: {
      type: 'object',
      properties: {
        path: {
          type: 'string',
          description: 'Path to the image file, relative to the current working directory.',
        },
        maxWidth: {
          type: 'number',
          description: 'Optional hint for downstream visual analysis pipelines.',
        },
      },
      required: ['path'],
    },
  },
};

function getDimensions(
  buffer: Buffer,
  ext: string,
): { width?: number; height?: number } | undefined {
  switch (ext) {
    case '.png':
      return readPngSize(buffer);
    case '.jpg':
    case '.jpeg':
      return readJpegSize(buffer);
    case '.gif':
      return readGifSize(buffer);
    case '.webp':
      return readWebpSize(buffer);
    case '.svg':
      return readSvgSize(buffer);
    default:
      return undefined;
  }
}

function readPngSize(buffer: Buffer): { width?: number; height?: number } | undefined {
  if (buffer.length < 24) return undefined;
  if (buffer.toString('ascii', 1, 4) !== 'PNG') return undefined;
  return {
    width: buffer.readUInt32BE(16),
    height: buffer.readUInt32BE(20),
  };
}

function readGifSize(buffer: Buffer): { width?: number; height?: number } | undefined {
  if (buffer.length < 10) return undefined;
  const signature = buffer.toString('ascii', 0, 6);
  if (signature !== 'GIF87a' && signature !== 'GIF89a') return undefined;
  return {
    width: buffer.readUInt16LE(6),
    height: buffer.readUInt16LE(8),
  };
}

function readJpegSize(buffer: Buffer): { width?: number; height?: number } | undefined {
  if (buffer.length < 4 || buffer[0] !== 0xff || buffer[1] !== 0xd8) return undefined;

  let offset = 2;
  while (offset + 9 < buffer.length) {
    if (buffer[offset] !== 0xff) {
      offset += 1;
      continue;
    }

    const marker = buffer[offset + 1];
    if (marker === 0xd9 || marker === 0xda) break;
    if (offset + 4 > buffer.length) break;

    const length = buffer.readUInt16BE(offset + 2);
    if (length < 2 || offset + 2 + length > buffer.length) break;

    if (isSofMarker(marker)) {
      if (offset + 9 > buffer.length) break;
      return {
        height: buffer.readUInt16BE(offset + 5),
        width: buffer.readUInt16BE(offset + 7),
      };
    }

    offset += 2 + length;
  }

  return undefined;
}

function isSofMarker(marker: number): boolean {
  return (
    (marker >= 0xc0 && marker <= 0xc3) ||
    (marker >= 0xc5 && marker <= 0xc7) ||
    (marker >= 0xc9 && marker <= 0xcb) ||
    (marker >= 0xcd && marker <= 0xcf)
  );
}

function readWebpSize(buffer: Buffer): { width?: number; height?: number } | undefined {
  if (buffer.length < 30) return undefined;
  if (buffer.toString('ascii', 0, 4) !== 'RIFF' || buffer.toString('ascii', 8, 12) !== 'WEBP') {
    return undefined;
  }

  const chunkType = buffer.toString('ascii', 12, 16);
  if (chunkType === 'VP8X' && buffer.length >= 30) {
    return {
      width: 1 + buffer.readUIntLE(24, 3),
      height: 1 + buffer.readUIntLE(27, 3),
    };
  }

  if (chunkType === 'VP8 ' && buffer.length >= 30) {
    return {
      width: buffer.readUInt16LE(26) & 0x3fff,
      height: buffer.readUInt16LE(28) & 0x3fff,
    };
  }

  if (chunkType === 'VP8L' && buffer.length >= 25) {
    const bits = buffer.readUInt32LE(21);
    return {
      width: (bits & 0x3fff) + 1,
      height: ((bits >> 14) & 0x3fff) + 1,
    };
  }

  return undefined;
}

function readSvgSize(buffer: Buffer): { width?: number; height?: number } | undefined {
  const text = buffer.toString('utf8');
  const width = parseSvgLength(text.match(/\bwidth\s*=\s*['"]([^'"]+)['"]/i)?.[1]);
  const height = parseSvgLength(text.match(/\bheight\s*=\s*['"]([^'"]+)['"]/i)?.[1]);
  if (width !== undefined || height !== undefined) {
    return { width, height };
  }

  const viewBox = text.match(/\bviewBox\s*=\s*['"]([^'"]+)['"]/i)?.[1];
  if (!viewBox) return undefined;
  const parts = viewBox
    .trim()
    .split(/[\s,]+/)
    .map((part) => Number(part));
  if (parts.length !== 4 || parts.some((part) => !Number.isFinite(part))) return undefined;
  return { width: parts[2], height: parts[3] };
}

function parseSvgLength(value: string | undefined): number | undefined {
  if (!value) return undefined;
  const match = value.trim().match(/^([0-9]*\.?[0-9]+)/);
  if (!match) return undefined;
  const parsed = Number(match[1]);
  return Number.isFinite(parsed) ? parsed : undefined;
}
