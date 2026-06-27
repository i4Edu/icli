import fs from 'node:fs';
import path from 'node:path';
import type {
  ChatCompletionContentPartImage,
  ChatCompletionContentPartText,
} from 'openai/resources/chat/completions';

const IMAGE_EXTENSION_PATTERN = /\.(png|jpe?g|gif|webp|svg)$/i;
const IMAGE_PATH_PATTERN =
  /"([^"\r\n]+\.(?:png|jpe?g|gif|webp|svg))"|'([^'\r\n]+\.(?:png|jpe?g|gif|webp|svg))'|((?:[A-Za-z]:[\\/]|\.{1,2}[\\/]|~[\\/]|\/)?[^\s"'`<>]+\.(?:png|jpe?g|gif|webp|svg))/gi;
const MIME_TYPES: Record<string, string> = {
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
  '.svg': 'image/svg+xml',
};
const VISION_MODEL_PATTERNS = [
  /^gpt-4o(?:$|-)/i,
  /^gpt-4\.1(?:$|-)/i,
  /^gpt-4-turbo(?:$|-)/i,
  /^gpt-4-vision(?:$|-)/i,
  /^o4(?:$|-)/i,
  /^claude-(?:3|3\.5|3\.7|sonnet-4|opus-4|haiku-4)/i,
  /^gemini/i,
];

export type MessageContentPart = ChatCompletionContentPartText | ChatCompletionContentPartImage;

export function detectImagePaths(message: string): string[] {
  const paths: string[] = [];
  const seen = new Set<string>();

  for (const match of message.matchAll(IMAGE_PATH_PATTERN)) {
    const candidate = normalizeDetectedPath(match[1] ?? match[2] ?? match[3] ?? '');
    if (!candidate) continue;
    const key = candidate.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    paths.push(candidate);
  }

  return paths;
}

export function encodeImageToBase64(filePath: string): { base64: string; mimeType: string } {
  const resolvedPath = path.resolve(filePath);
  const extension = path.extname(resolvedPath).toLowerCase();
  const mimeType = MIME_TYPES[extension];
  if (!mimeType) {
    throw new Error(`unsupported image type: ${filePath}`);
  }

  const base64 = fs.readFileSync(resolvedPath).toString('base64');
  return { base64, mimeType };
}

export function buildImageContent(filePaths: string[]): MessageContentPart[] {
  return filePaths.map((filePath) => {
    const { base64, mimeType } = encodeImageToBase64(filePath);
    return {
      type: 'image_url',
      image_url: {
        url: `data:${mimeType};base64,${base64}`,
      },
    };
  });
}

export function isVisionCapableModel(model: string): boolean {
  return VISION_MODEL_PATTERNS.some((pattern) => pattern.test(model.trim()));
}

function normalizeDetectedPath(rawValue: string): string | null {
  const value = rawValue.trim().replace(/[),.;:!?]+$/g, '');
  if (!value || /^(?:https?:|data:)/i.test(value)) return null;
  return IMAGE_EXTENSION_PATTERN.test(value) ? value : null;
}
