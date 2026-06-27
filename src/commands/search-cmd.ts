import { searchIndex, type SearchHit } from '../index/store.js';
import { theme } from '../ui/theme.js';

const DEFAULT_LIMIT = 6;
const PREVIEW_LIMIT = 180;

export async function searchCommand(args: string[], cwd: string): Promise<string> {
  const query = args.join(' ').trim();
  if (!query) {
    return theme.warn('usage: /search <query>\n');
  }

  try {
    const hits = await searchIndex(cwd, query, DEFAULT_LIMIT);
    if (!hits.length) {
      return theme.dim('No matches found.\n');
    }
    return formatResults(query, hits);
  } catch (error: unknown) {
    if (isMissingIndexError(error)) {
      return theme.warn('No index found. Run `/index build` first.\n');
    }

    const message = error instanceof Error ? error.message : String(error);
    return theme.err(`search failed: ${message}\n`);
  }
}

function formatResults(query: string, hits: SearchHit[]): string {
  const lines = [`${theme.brand('Search results')} ${theme.dim(`for "${query}"`)}`, ''];

  for (const hit of hits) {
    lines.push(`${theme.hl(hit.file)} ${theme.dim(`(score ${hit.score.toFixed(3)})`)}`);
    lines.push(`  ${formatPreview(hit.text)}`);
    lines.push('');
  }

  return `${lines.join('\n').trimEnd()}\n`;
}

function formatPreview(text: string): string {
  const normalized = text.replace(/\s+/g, ' ').trim();
  if (normalized.length <= PREVIEW_LIMIT) return normalized;
  return `${normalized.slice(0, PREVIEW_LIMIT - 3)}...`;
}

function isMissingIndexError(error: unknown): boolean {
  if (typeof error !== 'object' || error === null) {
    return false;
  }

  const code = 'code' in error ? String(error.code ?? '') : '';
  const message = 'message' in error ? String(error.message ?? '') : '';
  return code === 'ENOENT' || /no index found|index not found/i.test(message);
}
