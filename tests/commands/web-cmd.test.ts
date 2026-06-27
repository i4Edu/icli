import fs from 'node:fs';
import path from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { defaultContext } from '../../src/util/completion.js';
import {
  estimateTokens,
  fetchAndConvert,
  htmlToMarkdown,
  truncateMarkdown,
  validateWebUrl,
} from '../../src/commands/web-cmd.js';

describe('htmlToMarkdown', () => {
  it('converts headings, links, lists, and code blocks', () => {
    const markdown = htmlToMarkdown(`
      <html>
        <head>
          <title>Docs</title>
          <style>.hidden { display: none; }</style>
        </head>
        <body>
          <h1>Guide</h1>
          <p>Read the <a href="https://example.com/docs">documentation</a>.</p>
          <ul>
            <li>First item</li>
            <li><code>npm test</code></li>
          </ul>
          <pre><code>const value = 1;</code></pre>
          <script>window.alert('ignore me');</script>
        </body>
      </html>
    `);

    expect(markdown).toContain('# Guide');
    expect(markdown).toContain('[documentation](https://example.com/docs)');
    expect(markdown).toContain('- First item');
    expect(markdown).toContain('- `npm test`');
    expect(markdown).toContain('```');
    expect(markdown).toContain('const value = 1;');
    expect(markdown).not.toContain('ignore me');
    expect(markdown).not.toContain('display: none');
  });
});

describe('validateWebUrl', () => {
  it('accepts http and https URLs', () => {
    expect(validateWebUrl('https://example.com/path').toString()).toBe('https://example.com/path');
    expect(validateWebUrl('http://example.com').toString()).toBe('http://example.com/');
  });

  it('rejects invalid or unsupported URLs', () => {
    expect(() => validateWebUrl('notaurl')).toThrow('invalid URL');
    expect(() => validateWebUrl('ftp://example.com')).toThrow('unsupported URL protocol');
  });
});

describe('truncateMarkdown', () => {
  it('truncates long markdown and appends a notice', () => {
    const truncated = truncateMarkdown('a'.repeat(80), 40);

    expect(truncated.length).toBeLessThanOrEqual(80);
    expect(truncated).toContain('Content truncated at 40 characters');
  });
});

describe('estimateTokens', () => {
  it('uses the standard token heuristic when the tokenizer is cold', () => {
    expect(estimateTokens('123456789')).toBe(3);
  });
});

describe('fetchAndConvert', () => {
  afterEach(() => {
    delete process.env.ICOPILOT_WEB_MAX_CHARS;
    delete process.env.ICOPILOT_WEB_TIMEOUT_MS;
    vi.unstubAllGlobals();
  });

  it('fetches HTML, converts it to markdown, and honors truncation config', async () => {
    process.env.ICOPILOT_WEB_MAX_CHARS = '60';
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(
        `
          <html>
            <head><title>Example page</title></head>
            <body>
              <h1>Heading</h1>
              <p>${'content '.repeat(20)}</p>
            </body>
          </html>
        `,
        {
          status: 200,
          headers: { 'content-type': 'text/html' },
        },
      ),
    );
    vi.stubGlobal('fetch', fetchMock);

    const result = await fetchAndConvert('https://example.com/article');

    expect(fetchMock).toHaveBeenCalledWith(
      expect.any(URL),
      expect.objectContaining({
        headers: expect.objectContaining({ accept: 'text/html,application/xhtml+xml' }),
      }),
    );
    expect(result.title).toBe('Example page');
    expect(result.markdown).toContain('# Heading');
    expect(result.markdown).toContain('Content truncated at 60 characters');
    expect(result.tokens).toBeGreaterThan(0);
  });
});

describe('slash and completion integration', () => {
  it('wires /web into slash handling', () => {
    const slashSource = fs.readFileSync(path.join(process.cwd(), 'src', 'commands', 'slash.ts'), 'utf8');

    expect(slashSource).toContain("import { fetchAndConvert, validateWebUrl } from './web-cmd.js';");
    expect(slashSource).toContain('/web <url> [focus]');
    expect(slashSource).toContain("case 'web':");
    expect(slashSource).toContain("Content from ${url}:");
  });

  it('adds /web to shell completion context', () => {
    expect(defaultContext().slashCommands).toContain('web');
  });
});
