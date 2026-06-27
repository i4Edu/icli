import fs from 'node:fs';
import { RAGIndex, defaultRagIndexPath } from '../knowledge/rag.js';
import { theme } from '../ui/theme.js';

const DEFAULT_RESULTS = 5;
const PREVIEW_LENGTH = 220;

export async function ragCommand(args: string[], cwd: string): Promise<string> {
  const [subcommand = 'stats', ...rest] = args;
  const indexPath = defaultRagIndexPath(cwd);

  switch (subcommand.toLowerCase()) {
    case 'index': {
      const index = new RAGIndex();
      await index.indexProject(cwd);
      const stats = index.getStats();
      return (
        theme.ok(
          `✔ indexed ${stats.documents} documents, ${stats.chunks} chunks (${stats.totalTokens} tokens)\n`,
        ) + theme.dim(`  ${indexPath}\n`)
      );
    }
    case 'search': {
      const query = rest.join(' ').trim();
      if (!query) {
        return theme.warn('usage: /rag search <query>\n');
      }
      if (!fs.existsSync(indexPath)) {
        return theme.warn('No RAG index found. Run `/rag index` first.\n');
      }

      const index = new RAGIndex();
      index.load(indexPath);
      const matches = index.search(query, DEFAULT_RESULTS);
      if (!matches.length) {
        return theme.dim(`No RAG matches for "${query}".\n`);
      }

      const lines = [`${theme.brand('RAG results')} ${theme.dim(`for "${query}"`)}`, ''];
      for (const match of matches) {
        lines.push(
          `${theme.hl(match.metadata.file)} ${theme.dim(
            `(${match.metadata.startLine}-${match.metadata.endLine}, ${match.tokens} tokens)`,
          )}`,
        );
        lines.push(`  ${preview(match.text)}`);
        lines.push('');
      }
      return `${lines.join('\n').trimEnd()}\n`;
    }
    case 'stats': {
      if (!fs.existsSync(indexPath)) {
        return theme.warn('No RAG index found. Run `/rag index` first.\n');
      }

      const index = new RAGIndex();
      index.load(indexPath);
      const stats = index.getStats();
      return (
        `${theme.brand('RAG stats')}\n` +
        `  documents: ${theme.hl(String(stats.documents))}\n` +
        `  chunks:    ${theme.hl(String(stats.chunks))}\n` +
        `  tokens:    ${theme.hl(String(stats.totalTokens))}\n` +
        `  index:     ${theme.dim(indexPath)}\n`
      );
    }
    default:
      return theme.warn('usage: /rag index | /rag search <query> | /rag stats\n');
  }
}

function preview(text: string): string {
  const normalized = text.replace(/\s+/g, ' ').trim();
  if (normalized.length <= PREVIEW_LENGTH) return normalized;
  return `${normalized.slice(0, PREVIEW_LENGTH - 3)}...`;
}
