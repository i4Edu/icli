/**
 * Browser tool — renders pages using Playwright/Chromium.
 *
 * Advantages over plain web_fetch:
 *   • Executes JavaScript (SPAs, React, etc.)
 *   • Bypasses basic Cloudflare bot-detection (real browser fingerprint)
 *   • Can take screenshots
 *   • Handles redirects, cookies, and auth flows
 *
 * Activated when ICOPILOT_BROWSER=1 (or playwright-core is installed).
 */

import type { ChatCompletionTool } from 'openai/resources/chat/completions';

export interface BrowserFetchArgs {
  url: string;
  /** 'content' = rendered text/HTML (default), 'screenshot' = base64 PNG */
  mode?: 'content' | 'screenshot';
  /** CSS selector to wait for before extracting content */
  waitFor?: string;
  /** Additional JS to evaluate on the page, return value is appended */
  evaluate?: string;
  /** Max chars of content to return (default 40000) */
  maxChars?: number;
}

export interface BrowserClickArgs {
  url: string;
  selector: string;
  waitFor?: string;
}

// Stealth headers that mimic a real Chrome browser — helps bypass Cloudflare
const STEALTH_HEADERS: Record<string, string> = {
  'User-Agent':
    'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36',
  'Accept-Language': 'en-US,en;q=0.9',
  'Accept-Encoding': 'gzip, deflate, br',
  Accept:
    'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8',
  'Sec-Ch-Ua': '"Google Chrome";v="125", "Chromium";v="125", "Not-A.Brand";v="24"',
  'Sec-Ch-Ua-Mobile': '?0',
  'Sec-Ch-Ua-Platform': '"Linux"',
  'Sec-Fetch-Dest': 'document',
  'Sec-Fetch-Mode': 'navigate',
  'Sec-Fetch-Site': 'none',
  'Upgrade-Insecure-Requests': '1',
};

async function launchBrowser() {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { chromium } = await import('playwright-core');
  const browser = await chromium.launch({
    headless: true,
    args: [
      '--no-sandbox',
      '--disable-setuid-sandbox',
      '--disable-blink-features=AutomationControlled', // hide automation flag
      '--disable-dev-shm-usage',
      '--disable-web-security',
      '--disable-features=IsolateOrigins,site-per-process',
    ],
  });
  return browser;
}

export async function browserFetch(args: BrowserFetchArgs): Promise<string> {
  const maxChars = args.maxChars ?? 40_000;
  let browser;
  try {
    browser = await launchBrowser();
    const context = await browser.newContext({
      extraHTTPHeaders: STEALTH_HEADERS,
      userAgent: STEALTH_HEADERS['User-Agent'],
      viewport: { width: 1280, height: 800 },
      // Spoof webdriver property to bypass basic bot detection
      javaScriptEnabled: true,
    });

    // Remove webdriver property (Cloudflare checks this)
    await context.addInitScript(() => {
      Object.defineProperty(navigator, 'webdriver', { get: () => undefined });
    });

    const page = await context.newPage();
    await page.goto(args.url, { waitUntil: 'domcontentloaded', timeout: 30_000 });

    if (args.waitFor) {
      await page.waitForSelector(args.waitFor, { timeout: 10_000 }).catch(() => null);
    }

    // Wait a moment for JS to render
    await page.waitForTimeout(1500);

    if (args.mode === 'screenshot') {
      const buf = await page.screenshot({ fullPage: false, type: 'png' });
      return JSON.stringify({
        ok: true,
        url: page.url(),
        screenshot: buf.toString('base64'),
        mimeType: 'image/png',
      });
    }

    let extra = '';
    if (args.evaluate) {
      try {
        const result = await page.evaluate(args.evaluate);
        extra = `\n\n[evaluate result]: ${JSON.stringify(result)}`;
      } catch (e) {
        extra = `\n\n[evaluate error]: ${String(e)}`;
      }
    }

    const title = await page.title();
    const url = page.url();

    // Extract clean text content
    const text = await page.evaluate(() => {
      // Remove scripts, styles, nav, footer noise
      const remove = document.querySelectorAll(
        'script,style,noscript,nav,footer,header,aside,[role="navigation"],[aria-hidden="true"]',
      );
      remove.forEach((el) => el.remove());
      return document.body?.innerText ?? document.documentElement.innerText ?? '';
    });

    const content = (text + extra).slice(0, maxChars);
    return JSON.stringify({ ok: true, url, title, content, truncated: text.length > maxChars });
  } catch (err) {
    return JSON.stringify({ ok: false, error: String(err) });
  } finally {
    await browser?.close();
  }
}

export async function browserScreenshot(args: BrowserFetchArgs): Promise<string> {
  return browserFetch({ ...args, mode: 'screenshot' });
}

export const BROWSER_FETCH_SCHEMA: ChatCompletionTool = {
  type: 'function',
  function: {
    name: 'browser_fetch',
    description:
      'Open a URL in a real Chromium browser (executes JS, bypasses basic Cloudflare bot blocking). Returns rendered page text. Use this instead of web_fetch for JavaScript-heavy sites, SPAs, or sites with bot protection.',
    parameters: {
      type: 'object',
      properties: {
        url: { type: 'string', description: 'URL to open' },
        mode: {
          type: 'string',
          enum: ['content', 'screenshot'],
          description: 'content = page text (default), screenshot = base64 PNG',
        },
        waitFor: {
          type: 'string',
          description: 'CSS selector to wait for before extracting content',
        },
        evaluate: {
          type: 'string',
          description: 'JavaScript expression to evaluate on the page',
        },
        maxChars: { type: 'number', description: 'Max characters to return (default 40000)' },
      },
      required: ['url'],
    },
  },
};

export const BROWSER_SCREENSHOT_SCHEMA: ChatCompletionTool = {
  type: 'function',
  function: {
    name: 'browser_screenshot',
    description: 'Take a screenshot of a live website using a real Chromium browser.',
    parameters: {
      type: 'object',
      properties: {
        url: { type: 'string', description: 'URL to screenshot' },
        waitFor: { type: 'string', description: 'CSS selector to wait for' },
      },
      required: ['url'],
    },
  },
};
