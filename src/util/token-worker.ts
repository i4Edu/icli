import { parentPort } from 'node:worker_threads';
import { encode } from 'gpt-tokenizer';

parentPort?.on('message', (message: { text?: string }) => {
  try {
    const text = typeof message.text === 'string' ? message.text : '';
    parentPort?.postMessage({ count: encode(text).length });
  } catch (error: any) {
    parentPort?.postMessage({ error: String(error?.message || error) });
  }
});
