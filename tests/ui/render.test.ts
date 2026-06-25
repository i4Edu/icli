import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import { StreamSink } from '../../src/ui/render.js';

let writes: string[];
let spy: ReturnType<typeof vi.spyOn>;

beforeEach(() => {
  writes = [];
  spy = vi.spyOn(process.stdout, 'write').mockImplementation((chunk: string | Uint8Array) => {
    writes.push(String(chunk));
    return true;
  });
});

afterEach(() => spy.mockRestore());

describe('StreamSink incremental highlighting', () => {
  it('captures the raw buffer regardless of fence state', () => {
    const s = new StreamSink();
    s.write('Hello\n```ts\nconst x = 1;\n```\nbye');
    s.finalize();
    expect(s.text()).toBe('Hello\n```ts\nconst x = 1;\n```\nbye');
  });

  it('emits output for every line that was written', () => {
    const s = new StreamSink();
    s.write('a\n```\ncode\n```\nb\n');
    s.finalize();
    const joined = writes.join('');
    expect(joined).toContain('a');
    expect(joined).toContain('code');
    expect(joined).toContain('```');
    expect(joined).toContain('b');
  });

  it('handles fences split across token boundaries', () => {
    const s = new StreamSink();
    s.write('``');
    s.write('`\ncode\n``');
    s.write('`\n');
    s.finalize();
    expect(s.text()).toBe('```\ncode\n```\n');
  });
});
