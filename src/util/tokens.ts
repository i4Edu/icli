import { Worker } from 'node:worker_threads';
import { lazy } from './lazy.js';

type Encode = (s: string) => number[];

let _cachedEncode: Encode | null = null;

const loadTokenizer = lazy(async () => {
  const encode = (await import('gpt-tokenizer')).encode as Encode;
  _cachedEncode = encode;
  return encode;
});

export async function countTokens(text: string): Promise<number> {
  if (text.length > 200_000 && Worker) {
    return countTokensInWorker(text);
  }

  const encode = await loadTokenizer();
  return encode(text).length;
}

/**
 * Count tokens when the caller cannot await dynamic tokenizer loading.
 *
 * If the async tokenizer cache has already been warmed, this returns the exact
 * tokenizer count. Otherwise it returns the existing length/4 heuristic to keep
 * synchronous call sites cold-start friendly.
 */
export function countTokensSync(text: string): number {
  if (_cachedEncode) return _cachedEncode(text).length;
  return Math.ceil(text.length / 4);
}

export async function primeTokenizer(): Promise<void> {
  await loadTokenizer();
}

function countTokensInWorker(text: string): Promise<number> {
  return new Promise((resolve, reject) => {
    const worker = new Worker(new URL('./token-worker.js', import.meta.url));

    worker.once('message', (message: { count?: number; error?: string }) => {
      if (typeof message.count === 'number') {
        resolve(message.count);
      } else {
        reject(new Error(message.error || 'token worker failed'));
      }
      void worker.terminate();
    });
    worker.once('error', reject);
    worker.once('exit', (code) => {
      if (code !== 0) reject(new Error(`token worker exited with code ${code}`));
    });
    worker.postMessage({ text });
  });
}
