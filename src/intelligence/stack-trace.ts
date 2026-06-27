export interface StackFrame {
  file: string;
  line: number;
  column?: number;
  function?: string;
  isNative: boolean;
  isNodeModule: boolean;
}

export interface ParsedStackTrace {
  error: string;
  type: string;
  frames: StackFrame[];
  raw: string;
}

export interface StackAnalysis {
  rootCause: StackFrame;
  relevantFrames: StackFrame[];
  userFiles: string[];
  suggestion: string;
}

const UNKNOWN_FRAME: StackFrame = {
  file: '<unknown>',
  line: 0,
  isNative: true,
  isNodeModule: false,
};

export function parseStackTrace(text: string): ParsedStackTrace {
  const raw = normalizeStackTraceText(text);
  const lines = raw.split('\n');
  const frames = lines.map(parseFrame).filter((frame): frame is StackFrame => frame !== null);
  const { type, error } = extractErrorMetadata(lines);

  return {
    error,
    type,
    frames,
    raw,
  };
}

export function analyzeStackTrace(trace: ParsedStackTrace): StackAnalysis {
  const isPython = trace.raw.includes('Traceback (most recent call last):');
  const nonModuleFrames = trace.frames.filter((frame) => !frame.isNodeModule);
  const userFrames = nonModuleFrames.filter((frame) => !frame.isNative);
  const relevantFrames = orderRelevantFrames(userFrames.length ? userFrames : nonModuleFrames, isPython).slice(0, 6);
  const rootCause = relevantFrames[0] ?? nonModuleFrames[0] ?? trace.frames[0] ?? UNKNOWN_FRAME;
  const userFiles = uniqueFiles(userFrames);

  return {
    rootCause,
    relevantFrames,
    userFiles,
    suggestion: buildSuggestion(trace, rootCause, userFiles),
  };
}

export function formatForLLM(analysis: StackAnalysis): string {
  const lines = [
    'Stack trace analysis:',
    `- Root cause frame: ${formatFrame(analysis.rootCause)}`,
    `- Relevant frames (${analysis.relevantFrames.length}):`,
    ...analysis.relevantFrames.map((frame) => `  - ${formatFrame(frame)}`),
    `- User files (${analysis.userFiles.length}):`,
    ...(analysis.userFiles.length ? analysis.userFiles.map((file) => `  - ${file}`) : ['  - none detected']),
    `- Suggested investigation: ${analysis.suggestion}`,
  ];

  return lines.join('\n');
}

function normalizeStackTraceText(text: string): string {
  return text
    .trim()
    .replace(/\r\n/g, '\n')
    .replace(
      /\\r?\\n(?=\s*(?:at\s|File\s|Traceback\b|[A-Za-z_][\w.]*?(?:Error|Exception|Warning)\b|@))/g,
      '\n',
    );
}

function parseFrame(line: string): StackFrame | null {
  return parseNodeOrV8Frame(line) ?? parseBrowserFrame(line) ?? parsePythonFrame(line);
}

function parseNodeOrV8Frame(line: string): StackFrame | null {
  const trimmed = line.trim();
  if (!trimmed.startsWith('at ')) return null;

  const body = trimmed.slice(3).trim();
  const callsite = matchCallsite(body);
  if (!callsite) return null;

  return createFrame(callsite.location, callsite.fn);
}

function parseBrowserFrame(line: string): StackFrame | null {
  const trimmed = line.trim();
  if (!trimmed.includes('@') || trimmed.startsWith('at ')) return null;

  const atIndex = trimmed.lastIndexOf('@');
  const fn = trimmed.slice(0, atIndex).trim() || undefined;
  const location = trimmed.slice(atIndex + 1).trim();

  return createFrame(location, fn);
}

function parsePythonFrame(line: string): StackFrame | null {
  const match = line.match(/^\s*File\s+"(.+?)",\s+line\s+(\d+)(?:,\s+in\s+(.+))?\s*$/);
  if (!match) return null;

  const [, file, lineNumber, fn] = match;
  return {
    file,
    line: Number(lineNumber),
    function: fn?.trim() || undefined,
    isNative: isNativeLocation(file),
    isNodeModule: isNodeModuleFile(file),
  };
}

function matchCallsite(body: string): { fn?: string; location: string } | null {
  const wrappedMatch = body.match(/^(.*?) \((.+)\)$/);
  if (wrappedMatch) {
    const [, fn, location] = wrappedMatch;
    return { fn: fn.trim() || undefined, location: location.trim() };
  }

  return { location: body };
}

function createFrame(location: string, fn?: string): StackFrame | null {
  const parsed = parseLocation(location);
  if (parsed) {
    return {
      ...parsed,
      function: fn,
      isNative: isNativeLocation(parsed.file),
      isNodeModule: isNodeModuleFile(parsed.file),
    };
  }

  if (!isNativeLocation(location)) return null;

  return {
    file: location,
    line: 0,
    function: fn,
    isNative: true,
    isNodeModule: false,
  };
}

function parseLocation(location: string): Pick<StackFrame, 'file' | 'line' | 'column'> | null {
  const cleaned = location.trim().replace(/^\(|\)$/g, '');
  const match = cleaned.match(/^(.*):(\d+)(?::(\d+))$/);
  if (!match) return null;

  const [, file, line, column] = match;
  return {
    file,
    line: Number(line),
    column: Number(column),
  };
}

function extractErrorMetadata(lines: string[]): Pick<ParsedStackTrace, 'type' | 'error'> {
  const nonEmptyLines = lines.map((line) => line.trim()).filter(Boolean);
  const errorLine = [...nonEmptyLines].reverse().find((line) => looksLikeErrorLine(line)) ?? nonEmptyLines[0] ?? 'Error';
  const match = errorLine.match(/^([A-Za-z_][\w.]*)(?::\s*(.*))?$/);

  if (!match) {
    return { type: 'Error', error: errorLine };
  }

  const [, type, message] = match;
  return {
    type,
    error: message?.trim() || type,
  };
}

function looksLikeErrorLine(line: string): boolean {
  return /^[A-Za-z_][\w.]*?(?:Error|Exception|Warning)?(?::|$)/.test(line) && !line.startsWith('at ');
}

function orderRelevantFrames(frames: StackFrame[], isPython: boolean): StackFrame[] {
  return isPython ? [...frames].reverse() : [...frames];
}

function uniqueFiles(frames: StackFrame[]): string[] {
  const seen = new Set<string>();
  const files: string[] = [];

  for (const frame of frames) {
    if (seen.has(frame.file)) continue;
    seen.add(frame.file);
    files.push(frame.file);
  }

  return files;
}

function buildSuggestion(trace: ParsedStackTrace, rootCause: StackFrame, userFiles: string[]): string {
  const location = rootCause.line > 0 ? `${rootCause.file}:${rootCause.line}` : rootCause.file;
  const prefix = userFiles.length
    ? `Start with ${location}${rootCause.function ? ` in ${rootCause.function}` : ''}.`
    : 'The trace is dominated by runtime or dependency frames.';
  const type = trace.type.toLowerCase();
  const errorText = `${trace.type} ${trace.error}`.toLowerCase();

  if (type.includes('syntax')) {
    return `${prefix} This looks like a syntax issue, so inspect the exact line and the tokens immediately around it.`;
  }

  if (
    type.includes('typeerror') ||
    type.includes('attributeerror') ||
    errorText.includes('cannot read properties') ||
    errorText.includes('undefined')
  ) {
    return `${prefix} Check for null or undefined values, unexpected return shapes, and missing guards before the failing access.`;
  }

  if (
    type.includes('referenceerror') ||
    type.includes('nameerror') ||
    errorText.includes('is not defined')
  ) {
    return `${prefix} Verify that the symbol is defined in scope and imported from the expected module.`;
  }

  if (
    type.includes('modulenotfound') ||
    type.includes('importerror') ||
    errorText.includes('cannot find module')
  ) {
    return `${prefix} Re-check dependency installation, import paths, and the runtime working directory.`;
  }

  if (errorText.includes('enoent') || type.includes('filenotfounderror')) {
    return `${prefix} Confirm the file path exists relative to the process working directory and that the caller passes the right path.`;
  }

  return `${prefix} Follow the relevant user frames outward from the failing call and verify the inputs reaching that code path.`;
}

function formatFrame(frame: StackFrame): string {
  const location = frame.line > 0 ? `${frame.file}:${frame.line}${frame.column ? `:${frame.column}` : ''}` : frame.file;
  const fn = frame.function ? `${frame.function} @ ` : '';
  const flags = [
    frame.isNative ? 'native' : null,
    frame.isNodeModule ? 'node_modules' : null,
  ]
    .filter(Boolean)
    .join(', ');

  return `${fn}${location}${flags ? ` [${flags}]` : ''}`;
}

function isNodeModuleFile(file: string): boolean {
  return /(?:^|[\\/])node_modules(?:[\\/]|$)/.test(file);
}

function isNativeLocation(file: string): boolean {
  return (
    file === 'native' ||
    file.startsWith('node:') ||
    file.startsWith('internal/') ||
    file.startsWith('internal\\') ||
    file.startsWith('<')
  );
}
