import { countTokensSync } from '../util/tokens.js';

export interface WebFetchResult {
  title: string;
  markdown: string;
  tokens: number;
}

const DEFAULT_MAX_CHARS = 50_000;
const DEFAULT_TIMEOUT_MS = 15_000;
const CODE_BLOCK_TOKEN = '__ICLI_WEB_CODE_BLOCK_';

export async function fetchAndConvert(url: string): Promise<WebFetchResult> {
  const parsedUrl = validateWebUrl(url);
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), webTimeoutMs());

  try {
    const response = await fetch(parsedUrl, {
      headers: {
        accept: 'text/html,application/xhtml+xml',
      },
      signal: controller.signal,
    });

    if (!response.ok) {
      throw new Error(`failed to fetch ${parsedUrl.toString()}: ${response.status} ${response.statusText}`);
    }

    const html = await response.text();
    const title = extractTitle(html) || parsedUrl.hostname;
    const markdown = truncateMarkdown(htmlToMarkdown(html), webMaxChars());

    return {
      title,
      markdown,
      tokens: estimateTokens(markdown),
    };
  } finally {
    clearTimeout(timeout);
  }
}

export function validateWebUrl(url: string): URL {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    throw new Error(`invalid URL: ${url}`);
  }

  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    throw new Error(`unsupported URL protocol: ${parsed.protocol}`);
  }

  return parsed;
}

export function htmlToMarkdown(html: string): string {
  const codeBlocks: string[] = [];
  const stashProtected = (value: string): string => {
    const token = `${CODE_BLOCK_TOKEN}${codeBlocks.length}__`;
    codeBlocks.push(value);
    return token;
  };

  let markdown = html
    .replace(/\r/g, '')
    .replace(/<!--[\s\S]*?-->/g, '')
    .replace(/<head\b[^>]*>[\s\S]*?<\/head>/gi, '')
    .replace(/<(script|style|noscript|template)\b[^>]*>[\s\S]*?<\/\1>/gi, '')
    .replace(/<pre\b[^>]*>([\s\S]*?)<\/pre>/gi, (_match, inner) => {
      const text = decodeHtmlEntities(stripTags(inner)).trim();
      if (!text) return '';
      return stashProtected(`\n\n\`\`\`\n${text}\n\`\`\`\n\n`);
    });

  for (let level = 1; level <= 6; level += 1) {
    const heading = new RegExp(`<h${level}\\b[^>]*>([\\s\\S]*?)<\\/h${level}>`, 'gi');
    markdown = markdown.replace(heading, (_match, inner) => {
      const text = convertInline(inner, stashProtected).trim();
      return text ? `\n\n${'#'.repeat(level)} ${text}\n\n` : '';
    });
  }

  markdown = markdown
    .replace(/<blockquote\b[^>]*>([\s\S]*?)<\/blockquote>/gi, (_match, inner) => {
      const body = convertInline(inner, stashProtected).trim();
      if (!body) return '';
      return `\n\n${body
        .split(/\n+/)
        .map((line) => `> ${line.trim()}`)
        .join('\n')}\n\n`;
    })
    .replace(/<li\b[^>]*>([\s\S]*?)<\/li>/gi, (_match, inner) => {
      const text = convertInline(inner, stashProtected).trim();
      return text ? `\n- ${text}` : '';
    })
    .replace(/<(ul|ol)\b[^>]*>/gi, '\n')
    .replace(/<\/(ul|ol)>/gi, '\n')
    .replace(/<(p|div|section|article|main|aside|header|footer|nav|figure|figcaption)\b[^>]*>([\s\S]*?)<\/\1>/gi, (_match, _tag, inner) => {
      const text = convertInline(inner, stashProtected).trim();
      return text ? `\n\n${text}\n\n` : '';
    })
    .replace(/<br\s*\/?>/gi, '\n');

  markdown = decodeHtmlEntities(stripTags(markdown))
    .replace(/\u00a0/g, ' ')
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n[ \t]+/g, '\n')
    .replace(/[ \t]{2,}/g, ' ')
    .replace(/\n{3,}/g, '\n\n')
    .trim();

  return restoreCodeBlocks(markdown, codeBlocks);
}

export function truncateMarkdown(markdown: string, maxChars = webMaxChars()): string {
  if (maxChars <= 0 || markdown.length <= maxChars) return markdown;

  const suffix = `\n\n[Content truncated at ${maxChars} characters.]`;
  const sliceLength = Math.max(0, maxChars - suffix.length);
  return `${markdown.slice(0, sliceLength).trimEnd()}${suffix}`;
}

export function estimateTokens(text: string): number {
  try {
    return countTokensSync(text);
  } catch {
    return Math.ceil(text.length / 4);
  }
}

function convertInline(fragment: string, stashProtected?: (value: string) => string): string {
  let text = fragment;

  text = text
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<a\b[^>]*href\s*=\s*(['"])(.*?)\1[^>]*>([\s\S]*?)<\/a>/gi, (_match, _quote, href, inner) => {
      const label = convertInline(inner, stashProtected).trim() || String(href).trim();
      const normalizedHref = String(href).trim();
      return normalizedHref ? `[${label}](${normalizedHref})` : label;
    })
    .replace(/<code\b[^>]*>([\s\S]*?)<\/code>/gi, (_match, inner) => {
      const code = decodeHtmlEntities(stripTags(inner)).replace(/\s+/g, ' ').trim();
      if (!code) return '';
      const rendered = `\`${code.replace(/`/g, '\\`')}\``;
      return stashProtected ? stashProtected(rendered) : rendered;
    })
    .replace(/<(strong|b)\b[^>]*>([\s\S]*?)<\/\1>/gi, (_match, _tag, inner) => {
      const body = convertInline(inner, stashProtected).trim();
      return body ? `**${body}**` : '';
    })
    .replace(/<(em|i)\b[^>]*>([\s\S]*?)<\/\1>/gi, (_match, _tag, inner) => {
      const body = convertInline(inner, stashProtected).trim();
      return body ? `*${body}*` : '';
    });

  return stripTags(text)
    .replace(/\u00a0/g, ' ')
    .replace(/[ \t]+\n/g, '\n')
    .replace(/[ \t]{2,}/g, ' ')
    .trim();
}

function extractTitle(html: string): string {
  const match = html.match(/<title\b[^>]*>([\s\S]*?)<\/title>/i);
  if (!match) return '';
  return decodeHtmlEntities(convertInline(match[1]));
}

function stripTags(text: string): string {
  return text.replace(/<[^>]+>/g, '');
}

function decodeHtmlEntities(text: string): string {
  return text
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/gi, "'")
    .replace(/&#x27;/gi, "'")
    .replace(/&#x2F;/gi, '/')
    .replace(/&#(\d+);/g, (_match, codePoint) => {
      const value = Number.parseInt(codePoint, 10);
      return Number.isFinite(value) ? String.fromCodePoint(value) : _match;
    })
    .replace(/&#x([0-9a-f]+);/gi, (_match, codePoint) => {
      const value = Number.parseInt(codePoint, 16);
      return Number.isFinite(value) ? String.fromCodePoint(value) : _match;
    });
}

function restoreCodeBlocks(markdown: string, codeBlocks: string[]): string {
  return codeBlocks.reduce(
    (current, block, index) => current.replaceAll(`${CODE_BLOCK_TOKEN}${index}__`, block),
    markdown,
  );
}

function webMaxChars(): number {
  const parsed = Number.parseInt(process.env.ICOPILOT_WEB_MAX_CHARS ?? '', 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : DEFAULT_MAX_CHARS;
}

function webTimeoutMs(): number {
  const parsed = Number.parseInt(process.env.ICOPILOT_WEB_TIMEOUT_MS ?? '', 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : DEFAULT_TIMEOUT_MS;
}
