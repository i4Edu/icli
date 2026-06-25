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

/** Streaming sink: prints raw tokens with mild styling for low-latency feel. */
export class StreamSink {
  private buf = '';
  write(token: string) {
    this.buf += token;
    process.stdout.write(token);
  }
  /** After completion, optionally re-render fenced markdown for a polished view. */
  finalize(): string {
    process.stdout.write('\n');
    return this.buf;
  }
  /** Render captured markdown buffer as styled terminal output. */
  async renderMarkdown(): Promise<void> {
    if (!this.buf.trim()) return;
    try {
      const markdown = await ensureMarkdown();
      const rendered = markdown.parse(this.buf).trimEnd();
      // Clear streamed area is not portable; instead, print a divider + render
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
