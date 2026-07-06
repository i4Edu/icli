import fs from 'node:fs';
import path from 'node:path';
import type { Session } from '../session/session.js';
import { config } from '../config.js';
import { formatTrace, TraceRecorder } from '../observability/trace.js';
import { theme } from '../ui/theme.js';

const sessionRecorders = new WeakMap<Session, TraceRecorder>();

export function traceCommand(args: string[], session: Session): string {
  const [subcommand = 'show', targetPath] = args;
  const action = subcommand.toLowerCase();
  const recorder = getSessionTraceRecorder(session);

  switch (action) {
    case 'show': {
      const trace = recorder.getTrace();
      if (trace.entries.length === 0) {
        return `${theme.dim('No trace data recorded.')}\n`;
      }
      return `${formatTrace(trace)}\n`;
    }
    case 'clear':
      recorder.clear();
      recorder.start();
      return `${theme.ok('✔ cleared trace data')}\n`;
    case 'export': {
      const trace = recorder.getTrace();
      const outputPath = targetPath
        ? path.resolve(session.state.cwd || config.cwd, targetPath)
        : path.join(session.state.cwd || config.cwd, `trace-${session.state.id}.json`);
      fs.writeFileSync(outputPath, JSON.stringify(trace, null, 2), 'utf8');
      return `${theme.ok(`✔ exported trace to ${outputPath}`)}\n`;
    }
    default:
      return `${theme.warn('usage: /trace [show|clear|export [path]]')}\n`;
  }
}

export function getSessionTraceRecorder(session: Session): TraceRecorder {
  const existing = sessionRecorders.get(session);
  if (existing) return existing;

  const recorder = new TraceRecorder();
  recorder.start();
  sessionRecorders.set(session, recorder);
  return recorder;
}
