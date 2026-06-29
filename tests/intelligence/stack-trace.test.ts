import { describe, expect, it } from 'vitest';
import {
  analyzeStackTrace,
  formatForLLM,
  parseStackTrace,
} from '../../src/intelligence/stack-trace.js';

describe('stack trace intelligence', () => {
  it('parses Node.js and V8 stack frames', () => {
    const parsed = parseStackTrace(`TypeError: Cannot read properties of undefined (reading 'id')
    at renderUser (E:\\AI\\icli\\src\\app.ts:42:13)
    at E:\\AI\\icli\\src\\index.ts:10:3
    at process.processTicksAndRejections (node:internal/process/task_queues:95:5)`);

    expect(parsed.type).toBe('TypeError');
    expect(parsed.error).toContain('Cannot read properties of undefined');
    expect(parsed.frames).toHaveLength(3);
    expect(parsed.frames[0]).toMatchObject({
      file: 'E:\\AI\\icli\\src\\app.ts',
      line: 42,
      column: 13,
      function: 'renderUser',
      isNative: false,
      isNodeModule: false,
    });
    expect(parsed.frames[1]).toMatchObject({
      file: 'E:\\AI\\icli\\src\\index.ts',
      line: 10,
      column: 3,
    });
    expect(parsed.frames[2]?.isNative).toBe(true);
  });

  it('parses browser style stack frames', () => {
    const parsed = parseStackTrace(`TypeError: boom
renderUser@http://localhost:3000/src/app.ts:42:13
@http://localhost:3000/src/index.ts:10:3`);

    expect(parsed.frames).toHaveLength(2);
    expect(parsed.frames[0]).toMatchObject({
      file: 'http://localhost:3000/src/app.ts',
      line: 42,
      column: 13,
      function: 'renderUser',
    });
    expect(parsed.frames[1]?.function).toBeUndefined();
  });

  it('parses Python tracebacks and prefers the most recent user frame', () => {
    const parsed = parseStackTrace(`Traceback (most recent call last):
  File "E:\\AI\\icli\\scripts\\runner.py", line 20, in <module>
    main()
  File "E:\\AI\\icli\\src\\worker.py", line 55, in main
    explode()
ValueError: bad value`);
    const analysis = analyzeStackTrace(parsed);

    expect(parsed.type).toBe('ValueError');
    expect(parsed.error).toBe('bad value');
    expect(parsed.frames).toHaveLength(2);
    expect(analysis.rootCause).toMatchObject({
      file: 'E:\\AI\\icli\\src\\worker.py',
      line: 55,
      function: 'main',
    });
    expect(analysis.relevantFrames.map((frame) => frame.file)).toEqual([
      'E:\\AI\\icli\\src\\worker.py',
      'E:\\AI\\icli\\scripts\\runner.py',
    ]);
  });

  it('ignores node_modules frames during analysis and formats LLM context', () => {
    const parsed = parseStackTrace(`Error: boom
    at Object.transform (E:\\AI\\icli\\node_modules\\lib\\index.js:12:2)
    at handler (E:\\AI\\icli\\src\\feature.ts:8:4)
    at main (E:\\AI\\icli\\src\\index.ts:2:1)`);
    const analysis = analyzeStackTrace(parsed);
    const formatted = formatForLLM(analysis);

    expect(analysis.rootCause).toMatchObject({
      file: 'E:\\AI\\icli\\src\\feature.ts',
      line: 8,
      function: 'handler',
    });
    expect(analysis.relevantFrames).toHaveLength(2);
    expect(analysis.userFiles).toEqual([
      'E:\\AI\\icli\\src\\feature.ts',
      'E:\\AI\\icli\\src\\index.ts',
    ]);
    expect(analysis.suggestion).toContain('E:\\AI\\icli\\src\\feature.ts:8');
    expect(formatted).toContain('Root cause frame');
    expect(formatted).toContain('feature.ts');
    expect(formatted).not.toContain('node_modules\\lib\\index.js');
  });
});
