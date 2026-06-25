import fs from 'node:fs';
import path from 'node:path';
import { config } from '../config.js';

const FILE_REF_RE = /(^|\s)@([^\s@`'"<>]+)/g;

export interface FileRef {
  raw: string; // "@src/foo.ts"
  rel: string; // "src/foo.ts"
  abs: string;
  content?: string;
  error?: string;
}

const MAX_BYTES = 256 * 1024; // 256KB per file

export function parseFileRefs(input: string): FileRef[] {
  const out: FileRef[] = [];
  const seen = new Set<string>();
  let m: RegExpExecArray | null;
  FILE_REF_RE.lastIndex = 0;
  while ((m = FILE_REF_RE.exec(input))) {
    const rel = m[2];
    if (seen.has(rel)) continue;
    seen.add(rel);
    const abs = path.resolve(config.cwd, rel);
    const ref: FileRef = { raw: `@${rel}`, rel, abs };
    try {
      const st = fs.statSync(abs);
      if (!st.isFile()) {
        ref.error = 'not a file';
      } else if (st.size > MAX_BYTES) {
        ref.error = `file too large (${st.size} bytes; cap ${MAX_BYTES})`;
        ref.content = fs.readFileSync(abs, 'utf8').slice(0, MAX_BYTES);
      } else {
        ref.content = fs.readFileSync(abs, 'utf8');
      }
    } catch (e: any) {
      ref.error = e?.code || e?.message || 'read error';
    }
    out.push(ref);
  }
  return out;
}

/** Build a system-style context block from file refs. */
export function renderFileRefBlock(refs: FileRef[]): string | null {
  if (!refs.length) return null;
  const parts: string[] = ['### Referenced files'];
  for (const r of refs) {
    if (r.error && !r.content) {
      parts.push(`\n#### ${r.rel}\n_[error: ${r.error}]_`);
      continue;
    }
    const lang = path.extname(r.rel).replace(/^\./, '') || '';
    parts.push(`\n#### ${r.rel}\n\`\`\`${lang}\n${r.content}\n\`\`\``);
    if (r.error) parts.push(`_[note: ${r.error}]_`);
  }
  return parts.join('\n');
}
