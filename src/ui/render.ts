import { marked } from 'marked';
import TerminalRenderer from 'marked-terminal';
import { theme } from './theme.js';

let markdownConfigured = false;

// TODO: lazy-load marked/marked-terminal when cold-start budget matters.
export function ensureMarkdown(): void {
  if (markdownConfigured) return;
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
  renderMarkdown(): void {
    if (!this.buf.trim()) return;
    try {
      ensureMarkdown();
      const rendered = (marked.parse(this.buf) as string).trimEnd();
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

export function renderMarkdownString(md: string): string {
  try {
    ensureMarkdown();
    return (marked.parse(md) as string).trimEnd();
  } catch {
    return md;
  }
}
