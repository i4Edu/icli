import fs from 'node:fs';
import path from 'node:path';
import ts from 'typescript';
import { theme } from '../ui/theme.js';

export interface DiagramOptions {
  type: 'architecture' | 'deps' | 'classes' | 'flow';
  scope?: string;
  output?: string;
}

interface ParsedFile {
  file: string;
  relative: string;
  imports: string[];
  classes: ClassInfo[];
  functions: FunctionInfo[];
}

interface ClassInfo {
  id: string;
  name: string;
  file: string;
  extends?: string;
}

interface FunctionInfo {
  id: string;
  simpleName: string;
  fullName: string;
  file: string;
  className?: string;
  exported: boolean;
  calls: string[];
}

interface GraphNode {
  key: string;
  label: string;
  weight: number;
}

interface GraphEdge {
  from: string;
  to: string;
  count: number;
}

const MAX_NODES = 20;
const OMITTED_NODE_KEY = '__omitted__';
const SOURCE_EXTENSIONS = new Set(['.ts', '.tsx', '.js', '.jsx', '.mts', '.cts', '.mjs', '.cjs']);
const SKIP_DIRS = new Set([
  '.git',
  '.next',
  '.turbo',
  'build',
  'coverage',
  'dist',
  'node_modules',
  'out',
]);
const FLOW_ENTRY_NAMES = new Set([
  'main',
  'run',
  'start',
  'bootstrap',
  'createProgram',
  'handleSlash',
]);

export function diagramCommand(args: string[], cwd: string): string {
  const [subcommand, ...rest] = args;
  const scope = rest.join(' ').trim() || undefined;

  if (!subcommand) {
    return generateDiagram(cwd, { type: 'architecture' });
  }

  switch (subcommand.toLowerCase()) {
    case 'architecture':
      return generateDiagram(cwd, { type: 'architecture', scope });
    case 'deps':
      return generateDiagram(cwd, { type: 'deps', scope });
    case 'classes':
      return generateDiagram(cwd, { type: 'classes', scope });
    case 'flow':
      return generateDiagram(cwd, { type: 'flow', scope });
    default:
      return `${theme.warn('usage: /diagram [deps|classes [file]|flow [function]]')}\n`;
  }
}

export function generateDiagram(rootDir: string, opts: DiagramOptions): string {
  const cwd = path.resolve(rootDir);
  const scopeTarget = resolveScopeTarget(cwd, opts.scope);
  const files =
    opts.type === 'flow'
      ? collectSourceFiles(cwd)
      : collectSourceFiles(cwd, scopeTarget ?? undefined);
  const parsedFiles = parseProjectFiles(cwd, files);

  switch (opts.type) {
    case 'architecture':
      return buildArchitectureDiagram(cwd, parsedFiles);
    case 'deps':
      return buildDependencyDiagram(parsedFiles);
    case 'classes':
      return buildClassDiagram(parsedFiles);
    case 'flow':
      return buildFlowDiagram(cwd, parsedFiles, opts.scope);
  }
}

function buildArchitectureDiagram(rootDir: string, parsedFiles: ParsedFile[]): string {
  const entryFiles = new Set(detectEntryFiles(rootDir, parsedFiles));
  const nodes = new Map<string, GraphNode>();
  const edges = new Map<string, GraphEdge>();

  for (const parsed of parsedFiles) {
    const fromModule = detectModuleBoundary(parsed.relative);
    upsertNode(
      nodes,
      fromModule,
      entryFiles.has(parsed.file) ? `${fromModule}<br/>entry` : fromModule,
      1,
    );
    if (entryFiles.has(parsed.file)) {
      incrementNode(nodes, fromModule, 3);
    }

    for (const imported of parsed.imports) {
      const toModule = detectModuleBoundary(relativePath(rootDir, imported));
      upsertNode(nodes, toModule, entryFiles.has(imported) ? `${toModule}<br/>entry` : toModule, 1);
      incrementNode(nodes, fromModule, 1);
      incrementNode(nodes, toModule, 1);
      if (fromModule !== toModule) {
        upsertEdge(edges, fromModule, toModule);
      }
    }
  }

  return renderDirectedGraph('graph TD', nodes, edges, {
    emptyMessage: 'No module relationships found.',
    omittedLabel: 'other modules',
  });
}

function buildDependencyDiagram(parsedFiles: ParsedFile[]): string {
  const nodes = new Map<string, GraphNode>();
  const edges = new Map<string, GraphEdge>();

  for (const parsed of parsedFiles) {
    upsertNode(nodes, parsed.relative, parsed.relative, 1);
    for (const imported of parsed.imports) {
      const relativeImport = toPosixPath(
        parsedFiles.find((item) => item.file === imported)?.relative ?? '',
      );
      if (!relativeImport) continue;
      upsertNode(nodes, relativeImport, relativeImport, 1);
      incrementNode(nodes, parsed.relative, 1);
      incrementNode(nodes, relativeImport, 1);
      upsertEdge(edges, parsed.relative, relativeImport);
    }
  }

  return renderDirectedGraph('graph LR', nodes, edges, {
    emptyMessage: 'No file dependencies found.',
    omittedLabel: 'other files',
  });
}

function buildClassDiagram(parsedFiles: ParsedFile[]): string {
  const nodes = new Map<string, GraphNode>();
  const edges = new Map<string, GraphEdge>();
  const classByName = new Map<string, ClassInfo>();

  for (const parsed of parsedFiles) {
    for (const classInfo of parsed.classes) {
      classByName.set(classInfo.name, classInfo);
      upsertNode(nodes, classInfo.id, classInfo.name, 1);
    }
  }

  for (const parsed of parsedFiles) {
    for (const classInfo of parsed.classes) {
      if (!classInfo.extends) continue;
      const base = classByName.get(classInfo.extends);
      const baseKey = base?.id ?? `external:${classInfo.extends}`;
      const baseLabel = base?.name ?? `${classInfo.extends} (external)`;
      upsertNode(nodes, baseKey, baseLabel, base ? 1 : 0);
      incrementNode(nodes, classInfo.id, 1);
      incrementNode(nodes, baseKey, 1);
      upsertEdge(edges, baseKey, classInfo.id);
    }
  }

  return renderClassGraph(nodes, edges);
}

function buildFlowDiagram(rootDir: string, parsedFiles: ParsedFile[], scope?: string): string {
  const entryFiles = new Set(detectEntryFiles(rootDir, parsedFiles));
  const allFunctions = parsedFiles.flatMap((parsed) => parsed.functions);
  const functionById = new Map(allFunctions.map((fn) => [fn.id, fn]));
  const functionIdsBySimpleName = new Map<string, string[]>();
  const functionIdsByFullName = new Map<string, string>();

  for (const fn of allFunctions) {
    functionIdsByFullName.set(fn.fullName, fn.id);
    const ids = functionIdsBySimpleName.get(fn.simpleName) ?? [];
    ids.push(fn.id);
    functionIdsBySimpleName.set(fn.simpleName, ids);
  }

  const edges = new Map<string, GraphEdge>();
  const incoming = new Map<string, number>();
  for (const fn of allFunctions) {
    for (const call of fn.calls) {
      const targetId = resolveFunctionCall(
        fn,
        call,
        functionIdsBySimpleName,
        functionIdsByFullName,
      );
      if (!targetId || targetId === fn.id || !functionById.has(targetId)) continue;
      upsertEdge(edges, fn.id, targetId);
      incoming.set(targetId, (incoming.get(targetId) ?? 0) + 1);
    }
  }

  const rootIds = selectFlowRoots(
    allFunctions,
    scope,
    entryFiles,
    functionIdsBySimpleName,
    functionIdsByFullName,
    incoming,
  );
  const reachableIds = collectReachableNodes(rootIds, edges);
  const activeIds = reachableIds.size > 0 ? reachableIds : new Set(allFunctions.map((fn) => fn.id));
  const nodes = new Map<string, GraphNode>();
  const filteredEdges = new Map<string, GraphEdge>();

  for (const fn of allFunctions) {
    if (!activeIds.has(fn.id)) continue;
    const label = rootIds.has(fn.id) ? `${fn.fullName}<br/>entry` : fn.fullName;
    upsertNode(nodes, fn.id, label, 1 + (incoming.get(fn.id) ?? 0) + fn.calls.length);
    if (rootIds.has(fn.id)) {
      incrementNode(nodes, fn.id, 3);
    }
  }

  for (const edge of edges.values()) {
    if (!activeIds.has(edge.from) || !activeIds.has(edge.to)) continue;
    filteredEdges.set(`${edge.from}→${edge.to}`, edge);
  }

  return renderDirectedGraph('flowchart TD', nodes, filteredEdges, {
    emptyMessage: scope ? `No function flow found for "${scope}".` : 'No function flow found.',
    omittedLabel: 'other functions',
  });
}

function parseProjectFiles(rootDir: string, files: string[]): ParsedFile[] {
  const fileSet = new Set(files.map((file) => path.resolve(file)));
  return files
    .map((file) => parseSourceFile(rootDir, file, fileSet))
    .sort((left, right) => left.relative.localeCompare(right.relative));
}

function parseSourceFile(rootDir: string, file: string, fileSet: Set<string>): ParsedFile {
  const content = fs.readFileSync(file, 'utf8');
  const sourceFile = ts.createSourceFile(
    file,
    content,
    ts.ScriptTarget.Latest,
    true,
    scriptKindForFile(file),
  );
  const imports = new Set<string>();
  const classes: ClassInfo[] = [];
  const functions: FunctionInfo[] = [];

  const visit = (node: ts.Node, currentClass?: string): void => {
    if (
      (ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) &&
      node.moduleSpecifier &&
      ts.isStringLiteral(node.moduleSpecifier)
    ) {
      const resolved = resolveImportTarget(file, node.moduleSpecifier.text, fileSet);
      if (resolved) imports.add(resolved);
    }

    if (ts.isCallExpression(node)) {
      const moduleSpecifier = extractCallImport(node);
      if (moduleSpecifier) {
        const resolved = resolveImportTarget(file, moduleSpecifier, fileSet);
        if (resolved) imports.add(resolved);
      }
    }

    if (ts.isClassDeclaration(node) && node.name) {
      const className = node.name.text;
      const heritage = node.heritageClauses?.find(
        (clause) => clause.token === ts.SyntaxKind.ExtendsKeyword,
      );
      const extendsName = heritage?.types[0]?.expression.getText(sourceFile).trim();
      classes.push({
        id: `${relativePath(rootDir, file)}#${className}`,
        name: className,
        file,
        extends: extendsName,
      });
      ts.forEachChild(node, (child) => visit(child, className));
      return;
    }

    if (ts.isFunctionDeclaration(node) && node.name && node.body) {
      functions.push(
        createFunctionInfo(
          rootDir,
          file,
          node.name.text,
          node.body,
          sourceFile,
          undefined,
          isNodeExported(node),
        ),
      );
      return;
    }

    if (currentClass && ts.isMethodDeclaration(node) && node.body) {
      const methodName = getNodeName(node.name);
      if (methodName) {
        functions.push(
          createFunctionInfo(
            rootDir,
            file,
            methodName,
            node.body,
            sourceFile,
            currentClass,
            isNodeExported(node),
          ),
        );
      }
      return;
    }

    if (ts.isVariableDeclaration(node) && node.initializer && ts.isIdentifier(node.name)) {
      if (ts.isArrowFunction(node.initializer) || ts.isFunctionExpression(node.initializer)) {
        const body = ts.isBlock(node.initializer.body)
          ? node.initializer.body
          : ts.factory.createBlock([ts.factory.createReturnStatement(node.initializer.body)], true);
        functions.push(
          createFunctionInfo(
            rootDir,
            file,
            node.name.text,
            body,
            sourceFile,
            currentClass,
            isNodeExported(node.parent?.parent),
          ),
        );
        return;
      }
    }

    ts.forEachChild(node, (child) => visit(child, currentClass));
  };

  visit(sourceFile);
  return {
    file,
    relative: relativePath(rootDir, file),
    imports: Array.from(imports).sort((left, right) => left.localeCompare(right)),
    classes,
    functions,
  };
}

function createFunctionInfo(
  rootDir: string,
  file: string,
  simpleName: string,
  body: ts.Block,
  sourceFile: ts.SourceFile,
  className?: string,
  exported = false,
): FunctionInfo {
  const fullName = className ? `${className}.${simpleName}` : simpleName;
  return {
    id: `${relativePath(rootDir, file)}#${fullName}`,
    simpleName,
    fullName,
    file,
    className,
    exported,
    calls: collectCallNames(body, sourceFile, className),
  };
}

function collectCallNames(body: ts.Block, sourceFile: ts.SourceFile, className?: string): string[] {
  const calls = new Set<string>();

  const visit = (node: ts.Node): void => {
    if (node !== body && (ts.isFunctionLike(node) || ts.isClassLike(node))) {
      return;
    }

    if (ts.isCallExpression(node)) {
      const callName = getCallName(node, sourceFile, className);
      if (callName) calls.add(callName);
    }

    ts.forEachChild(node, visit);
  };

  ts.forEachChild(body, visit);
  return Array.from(calls);
}

function getCallName(
  node: ts.CallExpression,
  sourceFile: ts.SourceFile,
  className?: string,
): string | null {
  if (ts.isIdentifier(node.expression)) {
    return node.expression.text;
  }

  if (ts.isPropertyAccessExpression(node.expression)) {
    if (node.expression.expression.kind === ts.SyntaxKind.ThisKeyword && className) {
      return `${className}.${node.expression.name.text}`;
    }
    return node.expression.name.text;
  }

  if (node.expression.kind === ts.SyntaxKind.ImportKeyword) {
    const firstArg = node.arguments[0];
    if (firstArg && ts.isStringLiteral(firstArg)) {
      return `import:${firstArg.text}`;
    }
  }

  return node.expression.getText(sourceFile).trim() || null;
}

function resolveFunctionCall(
  source: FunctionInfo,
  call: string,
  functionIdsBySimpleName: Map<string, string[]>,
  functionIdsByFullName: Map<string, string>,
): string | null {
  if (call.startsWith('import:')) return null;
  if (functionIdsByFullName.has(call)) return functionIdsByFullName.get(call) ?? null;

  if (source.className) {
    const classQualified = `${source.className}.${call}`;
    if (functionIdsByFullName.has(classQualified)) {
      return functionIdsByFullName.get(classQualified) ?? null;
    }
  }

  const bySimple = functionIdsBySimpleName.get(call) ?? [];
  if (bySimple.length === 1) {
    return bySimple[0] ?? null;
  }
  return null;
}

function selectFlowRoots(
  functions: FunctionInfo[],
  scope: string | undefined,
  entryFiles: Set<string>,
  functionIdsBySimpleName: Map<string, string[]>,
  functionIdsByFullName: Map<string, string>,
  incoming: Map<string, number>,
): Set<string> {
  if (scope) {
    const trimmedScope = scope.trim();
    const exact = new Set<string>();
    const exactFull = functionIdsByFullName.get(trimmedScope);
    if (exactFull) exact.add(exactFull);
    for (const [simpleName, ids] of functionIdsBySimpleName) {
      if (simpleName === trimmedScope) ids.forEach((id) => exact.add(id));
    }
    if (exact.size > 0) return exact;

    const fuzzy = new Set(
      functions
        .filter(
          (fn) =>
            fn.fullName.toLowerCase().includes(trimmedScope.toLowerCase()) ||
            fn.simpleName.toLowerCase().includes(trimmedScope.toLowerCase()),
        )
        .map((fn) => fn.id),
    );
    if (fuzzy.size > 0) return fuzzy;
  }

  const preferred = functions
    .filter((fn) => entryFiles.has(fn.file) || fn.exported || FLOW_ENTRY_NAMES.has(fn.simpleName))
    .sort((left, right) => left.fullName.localeCompare(right.fullName))
    .slice(0, 3)
    .map((fn) => fn.id);
  if (preferred.length > 0) return new Set(preferred);

  const byIncoming = functions
    .filter((fn) => (incoming.get(fn.id) ?? 0) === 0)
    .sort((left, right) => left.fullName.localeCompare(right.fullName))
    .slice(0, 3)
    .map((fn) => fn.id);
  if (byIncoming.length > 0) return new Set(byIncoming);

  return new Set(functions.slice(0, 3).map((fn) => fn.id));
}

function collectReachableNodes(rootIds: Set<string>, edges: Map<string, GraphEdge>): Set<string> {
  const adjacency = new Map<string, string[]>();
  for (const edge of edges.values()) {
    const list = adjacency.get(edge.from) ?? [];
    list.push(edge.to);
    adjacency.set(edge.from, list);
  }

  const visited = new Set<string>();
  const queue = Array.from(rootIds);
  while (queue.length > 0) {
    const current = queue.shift();
    if (!current || visited.has(current)) continue;
    visited.add(current);
    for (const next of adjacency.get(current) ?? []) {
      if (!visited.has(next)) queue.push(next);
    }
  }
  return visited;
}

function renderDirectedGraph(
  header: string,
  nodes: Map<string, GraphNode>,
  edges: Map<string, GraphEdge>,
  options: { emptyMessage: string; omittedLabel: string },
): string {
  const limited = limitGraph(nodes, edges);
  const lines = ['```mermaid', header];

  if (limited.nodes.length === 0) {
    lines.push(`  empty["${escapeMermaidLabel(options.emptyMessage)}"]`);
    lines.push('```');
    return `${lines.join('\n')}\n`;
  }

  for (const node of limited.nodes) {
    lines.push(`  ${mermaidId(node.key)}["${escapeMermaidLabel(node.label)}"]`);
  }

  if (limited.omittedCount > 0) {
    lines.push(
      `  ${mermaidId(OMITTED_NODE_KEY)}["${escapeMermaidLabel(`${limited.omittedCount} ${options.omittedLabel}`)}"]`,
    );
    lines.push(`  %% ${limited.omittedCount} ${options.omittedLabel} omitted for readability`);
  }

  for (const edge of limited.edges) {
    const label = edge.count > 1 ? `|${edge.count}| ` : '';
    lines.push(`  ${mermaidId(edge.from)} --> ${label}${mermaidId(edge.to)}`);
  }

  lines.push('```');
  return `${lines.join('\n')}\n`;
}

function renderClassGraph(nodes: Map<string, GraphNode>, edges: Map<string, GraphEdge>): string {
  const limited = limitGraph(nodes, edges);
  const lines = ['```mermaid', 'classDiagram'];

  if (limited.nodes.length === 0) {
    lines.push('  class EmptyDiagram {');
    lines.push('    No classes found');
    lines.push('  }');
    lines.push('```');
    return `${lines.join('\n')}\n`;
  }

  for (const node of limited.nodes) {
    lines.push(`  class ${mermaidId(node.key)}["${escapeMermaidLabel(node.label)}"]`);
  }

  if (limited.omittedCount > 0) {
    lines.push(`  class ${mermaidId(OMITTED_NODE_KEY)} {`);
    lines.push(`    +${limited.omittedCount} more classes omitted`);
    lines.push('  }');
  }

  for (const edge of limited.edges) {
    lines.push(`  ${mermaidId(edge.from)} <|-- ${mermaidId(edge.to)}`);
  }

  lines.push('```');
  return `${lines.join('\n')}\n`;
}

function limitGraph(
  nodes: Map<string, GraphNode>,
  edges: Map<string, GraphEdge>,
): {
  nodes: GraphNode[];
  edges: GraphEdge[];
  omittedCount: number;
} {
  const sortedNodes = Array.from(nodes.values()).sort(
    (left, right) => right.weight - left.weight || left.label.localeCompare(right.label),
  );
  if (sortedNodes.length <= MAX_NODES) {
    return { nodes: sortedNodes, edges: Array.from(edges.values()), omittedCount: 0 };
  }

  const keptNodes = sortedNodes.slice(0, MAX_NODES - 1);
  const keptKeys = new Set(keptNodes.map((node) => node.key));
  const omittedCount = sortedNodes.length - keptNodes.length;
  const limitedEdges = new Map<string, GraphEdge>();

  for (const edge of edges.values()) {
    const from = keptKeys.has(edge.from) ? edge.from : OMITTED_NODE_KEY;
    const to = keptKeys.has(edge.to) ? edge.to : OMITTED_NODE_KEY;
    if (from === to && from === OMITTED_NODE_KEY) continue;
    const key = `${from}→${to}`;
    const current = limitedEdges.get(key);
    if (current) {
      current.count += edge.count;
    } else {
      limitedEdges.set(key, { from, to, count: edge.count });
    }
  }

  return {
    nodes: keptNodes,
    edges: Array.from(limitedEdges.values()),
    omittedCount,
  };
}

function upsertNode(
  nodes: Map<string, GraphNode>,
  key: string,
  label: string,
  weight: number,
): void {
  const current = nodes.get(key);
  if (current) {
    current.weight += weight;
    if (label.includes('<br/>entry')) current.label = label;
    return;
  }
  nodes.set(key, { key, label, weight });
}

function incrementNode(nodes: Map<string, GraphNode>, key: string, weight: number): void {
  const current = nodes.get(key);
  if (current) current.weight += weight;
}

function upsertEdge(edges: Map<string, GraphEdge>, from: string, to: string): void {
  const key = `${from}→${to}`;
  const current = edges.get(key);
  if (current) {
    current.count += 1;
    return;
  }
  edges.set(key, { from, to, count: 1 });
}

function collectSourceFiles(rootDir: string, scopeTarget?: string): string[] {
  const start = scopeTarget ?? rootDir;
  if (!fs.existsSync(start)) return [];
  const stat = fs.statSync(start);
  if (stat.isFile()) {
    return isIncludedSourceFile(start, rootDir, true) ? [path.resolve(start)] : [];
  }

  const files: string[] = [];
  const walk = (currentDir: string): void => {
    for (const entry of fs.readdirSync(currentDir, { withFileTypes: true })) {
      if (entry.isDirectory()) {
        if (SKIP_DIRS.has(entry.name)) continue;
        walk(path.join(currentDir, entry.name));
        continue;
      }

      const file = path.join(currentDir, entry.name);
      if (isIncludedSourceFile(file, rootDir, currentDir === start && Boolean(scopeTarget))) {
        files.push(path.resolve(file));
      }
    }
  };

  walk(start);
  return files.sort((left, right) => left.localeCompare(right));
}

function isIncludedSourceFile(file: string, rootDir: string, explicitScope: boolean): boolean {
  const extension = path.extname(file).toLowerCase();
  if (!SOURCE_EXTENSIONS.has(extension)) return false;
  if (file.endsWith('.d.ts')) return false;
  if (explicitScope) return true;

  const normalized = toPosixPath(relativePath(rootDir, file));
  return !(
    normalized.includes('/tests/') ||
    normalized.includes('/__tests__/') ||
    /\.test\.[cm]?[jt]sx?$/u.test(normalized) ||
    /\.spec\.[cm]?[jt]sx?$/u.test(normalized)
  );
}

function resolveScopeTarget(rootDir: string, scope?: string): string | null {
  if (!scope) return null;
  const resolved = path.resolve(rootDir, scope);
  if (fs.existsSync(resolved)) return resolved;

  const normalizedScope = toPosixPath(scope).replace(/^\.\//u, '');
  const candidates = collectSourceFiles(rootDir).filter((file) => {
    const relative = toPosixPath(relativePath(rootDir, file));
    return relative === normalizedScope || relative.endsWith(`/${normalizedScope}`);
  });
  return candidates[0] ?? null;
}

function detectEntryFiles(rootDir: string, parsedFiles: ParsedFile[]): string[] {
  const byRelative = new Map(
    parsedFiles.map((parsed) => [toPosixPath(parsed.relative), parsed.file]),
  );
  const candidates = new Set<string>();
  const packageJsonPath = path.join(rootDir, 'package.json');

  if (fs.existsSync(packageJsonPath)) {
    try {
      const pkg = JSON.parse(fs.readFileSync(packageJsonPath, 'utf8')) as {
        main?: string;
        bin?: string | Record<string, string>;
      };
      for (const value of extractPackageEntryValues(pkg)) {
        const resolved = resolveEntryCandidate(value, byRelative);
        if (resolved) candidates.add(resolved);
      }
    } catch {
      // ignore invalid package.json
    }
  }

  for (const candidate of ['src/index.ts', 'src/main.ts', 'src/cli.ts', 'index.ts', 'main.ts']) {
    const resolved = resolveEntryCandidate(candidate, byRelative);
    if (resolved) candidates.add(resolved);
  }

  return Array.from(candidates);
}

function extractPackageEntryValues(pkg: {
  main?: string;
  bin?: string | Record<string, string>;
}): string[] {
  const values: string[] = [];
  if (pkg.main) values.push(pkg.main);
  if (typeof pkg.bin === 'string') {
    values.push(pkg.bin);
  } else if (pkg.bin) {
    values.push(...Object.values(pkg.bin));
  }
  return values;
}

function resolveEntryCandidate(candidate: string, byRelative: Map<string, string>): string | null {
  const relative = toPosixPath(candidate).replace(/^\.\/+/u, '');
  const direct = byRelative.get(relative);
  if (direct) return direct;

  const asTs = relative.replace(/\.js$/u, '.ts');
  if (byRelative.has(asTs)) return byRelative.get(asTs) ?? null;

  const withoutBinPrefix = relative.replace(/^bin\//u, 'src/');
  if (byRelative.has(withoutBinPrefix)) return byRelative.get(withoutBinPrefix) ?? null;

  return null;
}

function detectModuleBoundary(relativeFile: string): string {
  const normalized = toPosixPath(relativeFile);
  const parts = normalized.split('/').filter(Boolean);
  if (parts.length === 0) return normalized;

  if (parts[0] === 'src' && parts.length >= 3) {
    return `src/${parts[1]}`;
  }
  if (parts[0] === 'src') {
    return normalized;
  }
  if (parts.length >= 2) {
    return parts[0]!;
  }
  return normalized;
}

function resolveImportTarget(
  fromFile: string,
  moduleSpecifier: string,
  fileSet: Set<string>,
): string | null {
  if (!moduleSpecifier.startsWith('.')) return null;
  const base = path.resolve(path.dirname(fromFile), moduleSpecifier);
  const candidates = [
    base,
    ...Array.from(SOURCE_EXTENSIONS, (extension) => `${base}${extension}`),
    ...Array.from(SOURCE_EXTENSIONS, (extension) => path.join(base, `index${extension}`)),
  ];

  if (/\.[cm]?[jt]sx?$/u.test(moduleSpecifier)) {
    const extless = base.replace(/\.[^.]+$/u, '');
    candidates.push(...Array.from(SOURCE_EXTENSIONS, (extension) => `${extless}${extension}`));
  }

  for (const candidate of candidates) {
    const resolved = path.resolve(candidate);
    if (fileSet.has(resolved)) return resolved;
  }
  return null;
}

function extractCallImport(node: ts.CallExpression): string | null {
  const firstArg = node.arguments[0];
  if (!firstArg || !ts.isStringLiteral(firstArg)) return null;

  if (ts.isIdentifier(node.expression) && node.expression.text === 'require') {
    return firstArg.text;
  }
  if (node.expression.kind === ts.SyntaxKind.ImportKeyword) {
    return firstArg.text;
  }
  return null;
}

function isNodeExported(node: ts.Node | undefined): boolean {
  if (!node) return false;
  return Boolean(ts.getCombinedModifierFlags(node as ts.Declaration) & ts.ModifierFlags.Export);
}

function getNodeName(name: ts.PropertyName): string | null {
  if (ts.isIdentifier(name) || ts.isStringLiteral(name) || ts.isNumericLiteral(name)) {
    return name.text;
  }
  return null;
}

function scriptKindForFile(file: string): ts.ScriptKind {
  const extension = path.extname(file).toLowerCase();
  switch (extension) {
    case '.tsx':
      return ts.ScriptKind.TSX;
    case '.jsx':
      return ts.ScriptKind.JSX;
    case '.js':
    case '.mjs':
    case '.cjs':
      return ts.ScriptKind.JS;
    default:
      return ts.ScriptKind.TS;
  }
}

function relativePath(rootDir: string, file: string): string {
  return toPosixPath(path.relative(rootDir, file) || path.basename(file));
}

function toPosixPath(value: string): string {
  return value.replace(/\\/gu, '/');
}

function mermaidId(key: string): string {
  return key.replace(/[^A-Za-z0-9_]/gu, '_');
}

function escapeMermaidLabel(value: string): string {
  return value.replace(/"/gu, '&quot;');
}
