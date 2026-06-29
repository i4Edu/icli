import { theme } from './theme.js';
import { lazy } from '../util/lazy.js';

let markdownConfigured = false;

const loadMarked = lazy(async () => import('marked'));
const loadTerminalRenderer = lazy(async () => (await import('marked-terminal')).default);

export async function ensureMarkdown(): Promise<{ parse: (md: string) => string }> {
  const [{ marked }, TerminalRenderer] = await Promise.all([loadMarked(), loadTerminalRenderer()]);
  if (markdownConfigured) {
    return { parse: (md: string) => marked.parse(md) as string };
  }
  marked.setOptions({
    // @ts-expect-error — marked-terminal's renderer is compatible at runtime.
    renderer: new TerminalRenderer({
      reflowText: false,
      showSectionPrefix: false,
      tab: 2,
      codespan: theme.hl,
    }),
  });
  markdownConfigured = true;
  return { parse: (md: string) => marked.parse(md) as string };
}

/** Streaming sink: prints raw tokens with mild styling for low-latency feel.
 *  Tracks fenced ``` code blocks across token boundaries and renders the
 *  inside of a fence in `theme.hl` so the user can visually distinguish code
 *  from prose during streaming, without waiting for the full markdown render. */
import { syntaxHighlightShell } from '../tools/shell.js';

export class StreamSink {
  private buf = '';
  private inCode = false;
  private codeLang = '';
  private lineBuf = '';

  write(token: string) {
    this.buf += token;
    for (const ch of token) {
      this.lineBuf += ch;
      if (ch === '\n') {
        this.flushLine();
      }
    }
  }

  private flushLine() {
    const line = this.lineBuf;
    this.lineBuf = '';
    const trimmed = line.trimStart();
    if (trimmed.startsWith('```')) {
      // Toggle fence; capture the language tag
      if (!this.inCode) {
        this.codeLang = trimmed.slice(3).trim().toLowerCase();
        this.inCode = true;
      } else {
        this.inCode = false;
        this.codeLang = '';
      }
      process.stdout.write(theme.dim(line));
      return;
    }
    if (this.inCode) {
      const isShell = ['sh', 'bash', 'zsh', 'shell', 'fish', ''].includes(this.codeLang);
      if (isShell) {
        process.stdout.write(syntaxHighlightShell(line));
      } else {
        process.stdout.write(theme.hl(line));
      }
      return;
    }
    process.stdout.write(line);
  }

  /** After completion, optionally re-render fenced markdown for a polished view. */
  finalize(): string {
    if (this.lineBuf) {
      // flush any trailing partial line
      const tail = this.lineBuf;
      this.lineBuf = '';
      if (this.inCode) process.stdout.write(theme.hl(tail));
      else process.stdout.write(tail);
    }
    process.stdout.write('\n');
    return this.buf;
  }

  /** Render captured markdown buffer as styled terminal output. */
  async renderMarkdown(): Promise<void> {
    if (!this.buf.trim()) return;
    try {
      const markdown = await ensureMarkdown();
      const rendered = markdown.parse(this.buf).trimEnd();
      process.stdout.write(theme.dim('─'.repeat(60)) + '\n');
      process.stdout.write(rendered + '\n');
    } catch {
      /* fall back silently — raw stream already shown */
    }
  }
  text() {
    return this.buf;
  }
}

export async function renderMarkdownString(md: string): Promise<string> {
  try {
    const markdown = await ensureMarkdown();
    return markdown.parse(md).trimEnd();
  } catch {
    return md;
  }
}
