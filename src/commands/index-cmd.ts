import path from 'node:path';
import fs from 'node:fs';
import { config } from '../config.js';
import { theme } from '../ui/theme.js';
import { buildIndex } from '../index/indexer.js';
import { retrieve } from '../index/retrieve.js';

export async function indexCommand(rest: string[]): Promise<void> {
  const [sub = 'status', ...args] = rest;
  switch (sub.toLowerCase()) {
    case 'build': {
      process.stdout.write(theme.dim('Indexing repository (this requires GITHUB_TOKEN)…\n'));
      try {
        const r = await buildIndex(config.cwd);
        process.stdout.write(
          theme.ok(`✔ indexed ${r.files} files, ${r.chunks} new chunks in ${r.ms}ms\n`) +
            theme.dim(`  ${r.outPath}\n`),
        );
      } catch (e: unknown) {
        process.stdout.write(theme.err(`index build failed: ${(e as Error)?.message || e}\n`));
      }
      return;
    }
    case 'status': {
      const idx = path.join(config.cwd, '.icopilot', 'index.json');
      if (!fs.existsSync(idx)) {
        process.stdout.write(theme.warn('No index found. Run /index build first.\n'));
        return;
      }
      try {
        const parsed = JSON.parse(fs.readFileSync(idx, 'utf8'));
        process.stdout.write(
          `\n  model: ${theme.hl(parsed.model || '?')}\n` +
            `  built: ${parsed.createdAt || '?'}\n` +
            `  entries: ${Array.isArray(parsed.entries) ? parsed.entries.length : 0}\n\n`,
        );
      } catch (e: unknown) {
        process.stdout.write(theme.err(`failed to read index: ${(e as Error)?.message || e}\n`));
      }
      return;
    }
    case 'search': {
      const query = args.join(' ').trim();
      if (!query) {
        process.stdout.write(theme.warn('usage: /index search <query>\n'));
        return;
      }
      try {
        const hits = await retrieve(config.cwd, query, 6);
        if (!hits.length) {
          process.stdout.write(theme.dim('no matches (or index missing).\n'));
          return;
        }
        for (const h of hits) {
          const snippet = h.text.replace(/\s+/g, ' ').slice(0, 200);
          process.stdout.write(
            `${theme.hl(h.file)} chunk ${h.chunk} ${theme.dim(`(score ${h.score.toFixed(3)})`)}\n` +
              `  ${snippet}\n`,
          );
        }
      } catch (e: unknown) {
        process.stdout.write(theme.err(`search failed: ${(e as Error)?.message || e}\n`));
      }
      return;
    }
    default:
      process.stdout.write(theme.warn('usage: /index build | /index status | /index search <q>\n'));
  }
}
