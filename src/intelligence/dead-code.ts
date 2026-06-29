import fs from 'node:fs';
import path from 'node:path';
import fg from 'fast-glob';

export interface ScanOptions {
  extensions?: string[];
  exclude?: string[];
  entryPoints?: string[];
}

export interface UnusedExport {
  name: string;
  file: string;
  line: number;
  kind: string;
}

export interface DeadCodeReport {
  unusedExports: UnusedExport[];
  unusedFiles: string[];
  stats: {
    total: number;
    unused: number;
    percentage: number;
  };
}

interface ExportRecord extends UnusedExport {
  source?: string;
  sourceName?: string;
}

interface ModuleInfo {
  file: string;
  exports: Map<string, ExportRecord>;
  exportAll: string[];
  importedNames: Set<string>;
  inboundReferences: number;
}

const DEFAULT_EXTENSIONS = ['.ts', '.tsx', '.mts', '.cts', '.js', '.jsx', '.mjs', '.cjs'];
const DEFAULT_EXCLUDES = [
  '**/node_modules/**',
  '**/dist/**',
  '**/.git/**',
  '**/coverage/**',
  '**/*.d.ts',
  '**/__tests__/**',
  '**/tests/**',
  '**/*.test.*',
  '**/*.spec.*',
];
const RUNTIME_EXTENSIONS = ['.js', '.jsx', '.mjs', '.cjs'];

export class DeadCodeDetector {
  scan(rootDir: string, options: ScanOptions = {}): DeadCodeReport {
    const state = this.buildState(rootDir, options);
    const unusedExports = this.computeUnusedExports(state);
    const unusedFiles = this.computeUnusedFiles(state);
    const total = state.files.length + state.totalExports;
    const unused = unusedFiles.length + unusedExports.length;

    return {
      unusedExports,
      unusedFiles,
      stats: {
        total,
        unused,
        percentage: total === 0 ? 0 : Number(((unused / total) * 100).toFixed(2)),
      },
    };
  }

  getUnusedExports(rootDir: string): UnusedExport[] {
    return this.scan(rootDir).unusedExports;
  }

  getUnusedFiles(rootDir: string): string[] {
    return this.scan(rootDir).unusedFiles;
  }

  private buildState(rootDir: string, options: ScanOptions) {
    const normalizedRoot = path.resolve(rootDir);
    const extensions = normalizeExtensions(options.extensions);
    const files = listSourceFiles(normalizedRoot, extensions, options.exclude);
    const entryPoints = findEntryPoints(normalizedRoot, files, extensions, options.entryPoints);
    const modules = new Map<string, ModuleInfo>();

    for (const file of files) {
      const moduleInfo: ModuleInfo = {
        file,
        exports: new Map(),
        exportAll: [],
        importedNames: new Set(),
        inboundReferences: 0,
      };
      modules.set(file, moduleInfo);
    }

    for (const file of files) {
      const content = safeRead(file);
      if (content === undefined) continue;

      const moduleInfo = modules.get(file);
      if (!moduleInfo) continue;
      const lineLookup = createLineLookup(content);

      this.collectExports(moduleInfo, content, lineLookup);
      this.collectImports(modules, normalizedRoot, file, content, extensions);
    }

    this.propagateReExportUsage(modules, normalizedRoot, entryPoints, extensions);

    const totalExports = [...modules.values()].reduce(
      (sum, moduleInfo) => sum + moduleInfo.exports.size,
      0,
    );

    return {
      rootDir: normalizedRoot,
      files,
      modules,
      entryPoints,
      totalExports,
    };
  }

  private collectExports(moduleInfo: ModuleInfo, content: string, lineLookup: number[]): void {
    const register = (
      name: string,
      line: number,
      kind: string,
      source?: string,
      sourceName?: string,
    ) => {
      const exportName = name.trim();
      if (!exportName || moduleInfo.exports.has(exportName)) return;
      moduleInfo.exports.set(exportName, {
        name: exportName,
        file: moduleInfo.file,
        line,
        kind,
        source,
        sourceName,
      });
    };

    const declarationExport =
      /^\s*export\s+(?:declare\s+)?(?:(default)\s+)?(?:(async)\s+)?(function|class|interface|type|enum|const|let|var)\s+([A-Za-z_$][\w$]*)/gmu;
    for (const match of content.matchAll(declarationExport)) {
      const [, isDefault, , kind, name] = match;
      const line = lookupLine(lineLookup, match.index ?? 0);
      if (name) register(name, line, kind ?? 'symbol');
      if (isDefault) register('default', line, kind ?? 'default');
    }

    const anonymousDefaultExport =
      /^\s*export\s+default\s+(?!function\s+[A-Za-z_$]|class\s+[A-Za-z_$])(?:async\s+)?(function|class)?/gmu;
    for (const match of content.matchAll(anonymousDefaultExport)) {
      const line = lookupLine(lineLookup, match.index ?? 0);
      register('default', line, match[1] ?? 'default');
    }

    const namedExport = /^\s*export\s*\{([^}]+)\}\s*(?:from\s*['"]([^'"]+)['"])?/gmu;
    for (const match of content.matchAll(namedExport)) {
      const line = lookupLine(lineLookup, match.index ?? 0);
      const specifier = match[2];
      for (const item of splitNamedBindings(match[1] ?? '')) {
        const parsed = parseNamedBinding(item);
        if (!parsed) continue;
        register(
          parsed.exportedName,
          line,
          specifier ? 're-export' : 'named export',
          specifier,
          parsed.importedName,
        );
      }
    }

    const exportNamespace =
      /^\s*export\s+\*\s+as\s+([A-Za-z_$][\w$]*)\s+from\s+['"]([^'"]+)['"]/gmu;
    for (const match of content.matchAll(exportNamespace)) {
      const line = lookupLine(lineLookup, match.index ?? 0);
      const [, name, specifier] = match;
      if (name && specifier) register(name, line, 'namespace re-export', specifier, '*');
    }

    const exportAll = /^\s*export\s+\*\s+from\s+['"]([^'"]+)['"]/gmu;
    for (const match of content.matchAll(exportAll)) {
      const specifier = match[1];
      if (specifier) moduleInfo.exportAll.push(specifier);
    }
  }

  private collectImports(
    modules: Map<string, ModuleInfo>,
    rootDir: string,
    importerFile: string,
    content: string,
    extensions: string[],
  ): void {
    const importer = modules.get(importerFile);
    if (!importer) return;

    const registerFileReference = (specifier: string) => {
      const resolved = resolveModuleSpecifier(rootDir, importerFile, specifier, extensions);
      if (!resolved) return null;
      const target = modules.get(resolved);
      if (!target) return null;
      target.inboundReferences += 1;
      return target;
    };

    const importFrom = /^\s*import\s+(?!['"])([\s\S]*?)\s+from\s+['"]([^'"]+)['"]/gmu;
    for (const match of content.matchAll(importFrom)) {
      const clause = match[1];
      const specifier = match[2];
      if (!clause || !specifier) continue;
      const target = registerFileReference(specifier);
      if (!target) continue;
      for (const name of parseImportClause(clause)) {
        target.importedNames.add(name);
      }
    }

    const sideEffectImport = /^\s*import\s+['"]([^'"]+)['"]/gmu;
    for (const match of content.matchAll(sideEffectImport)) {
      const specifier = match[1];
      if (specifier) registerFileReference(specifier);
    }

    const reExportFrom = /^\s*export\s*\{([^}]+)\}\s*from\s*['"]([^'"]+)['"]/gmu;
    for (const match of content.matchAll(reExportFrom)) {
      const bindings = match[1];
      const specifier = match[2];
      if (!bindings || !specifier) continue;
      const target = registerFileReference(specifier);
      if (!target) continue;
      for (const item of splitNamedBindings(bindings)) {
        const parsed = parseNamedBinding(item);
        if (parsed) target.importedNames.add(parsed.importedName);
      }
    }

    const exportAll = /^\s*export\s+\*\s+from\s+['"]([^'"]+)['"]/gmu;
    for (const match of content.matchAll(exportAll)) {
      const specifier = match[1];
      if (specifier) registerFileReference(specifier);
    }

    const exportNamespace = /^\s*export\s+\*\s+as\s+[A-Za-z_$][\w$]*\s+from\s+['"]([^'"]+)['"]/gmu;
    for (const match of content.matchAll(exportNamespace)) {
      const specifier = match[1];
      if (specifier) registerFileReference(specifier);
    }

    const dynamicImport = /\bimport\s*\(\s*['"]([^'"]+)['"]\s*\)/gmu;
    for (const match of content.matchAll(dynamicImport)) {
      const specifier = match[1];
      if (specifier) registerFileReference(specifier);
    }

    const requireCall = /\brequire\s*\(\s*['"]([^'"]+)['"]\s*\)/gmu;
    for (const match of content.matchAll(requireCall)) {
      const specifier = match[1];
      if (specifier) registerFileReference(specifier);
    }
  }

  private propagateReExportUsage(
    modules: Map<string, ModuleInfo>,
    rootDir: string,
    entryPoints: Set<string>,
    extensions: string[],
  ): void {
    for (const entryPoint of entryPoints) {
      const moduleInfo = modules.get(entryPoint);
      if (!moduleInfo) continue;
      for (const name of moduleInfo.exports.keys()) {
        moduleInfo.importedNames.add(name);
      }
    }

    let changed = true;
    while (changed) {
      changed = false;

      for (const [file, moduleInfo] of modules) {
        for (const record of moduleInfo.exports.values()) {
          if (!record.source || !moduleInfo.importedNames.has(record.name)) continue;
          const targetFile = resolveModuleSpecifier(rootDir, file, record.source, extensions);
          const target = targetFile ? modules.get(targetFile) : undefined;
          if (!target || !record.sourceName) continue;
          if (!target.importedNames.has(record.sourceName)) {
            target.importedNames.add(record.sourceName);
            changed = true;
          }
        }

        if (moduleInfo.importedNames.size === 0 || moduleInfo.exportAll.length === 0) continue;

        for (const specifier of moduleInfo.exportAll) {
          const targetFile = resolveModuleSpecifier(rootDir, file, specifier, extensions);
          const target = targetFile ? modules.get(targetFile) : undefined;
          if (!target) continue;

          for (const name of moduleInfo.importedNames) {
            if (!target.exports.has(name) || target.importedNames.has(name)) continue;
            target.importedNames.add(name);
            changed = true;
          }
        }
      }
    }
  }

  private computeUnusedExports(state: {
    rootDir: string;
    modules: Map<string, ModuleInfo>;
    entryPoints: Set<string>;
  }): UnusedExport[] {
    const unused: UnusedExport[] = [];

    for (const [file, moduleInfo] of state.modules) {
      if (state.entryPoints.has(file)) continue;
      for (const record of moduleInfo.exports.values()) {
        if (moduleInfo.importedNames.has(record.name)) continue;
        unused.push({
          name: record.name,
          file: toRelativeFile(state.rootDir, record.file),
          line: record.line,
          kind: record.kind,
        });
      }
    }

    return unused.sort(compareUnusedExports);
  }

  private computeUnusedFiles(state: {
    rootDir: string;
    files: string[];
    modules: Map<string, ModuleInfo>;
    entryPoints: Set<string>;
  }): string[] {
    return state.files
      .filter((file) => !state.entryPoints.has(file))
      .filter((file) => (state.modules.get(file)?.inboundReferences ?? 0) === 0)
      .map((file) => toRelativeFile(state.rootDir, file))
      .sort((left, right) => left.localeCompare(right));
  }
}

function listSourceFiles(rootDir: string, extensions: string[], exclude: string[] = []): string[] {
  const patterns = extensions.map((extension) => `**/*${extension}`);
  const files = fg.sync(patterns, {
    cwd: rootDir,
    onlyFiles: true,
    absolute: true,
    unique: true,
    dot: false,
    ignore: [...DEFAULT_EXCLUDES, ...readGitignorePatterns(rootDir), ...exclude],
  });

  return files.map((file) => path.resolve(file)).sort((left, right) => left.localeCompare(right));
}

function normalizeExtensions(extensions?: string[]): string[] {
  if (!extensions?.length) return [...DEFAULT_EXTENSIONS];
  return [
    ...new Set(
      extensions.map((extension) => (extension.startsWith('.') ? extension : `.${extension}`)),
    ),
  ];
}

function findEntryPoints(
  rootDir: string,
  files: string[],
  extensions: string[],
  entryPoints: string[] = [],
): Set<string> {
  const entries = new Set<string>();

  for (const file of files) {
    const normalized = normalizeForMatch(path.relative(rootDir, file));
    if (path.basename(file).startsWith('index.')) entries.add(file);
    if (normalized.startsWith('bin/')) entries.add(file);
  }

  for (const entryPoint of entryPoints) {
    const resolved = resolveExplicitEntryPoint(rootDir, entryPoint, files, extensions);
    if (resolved) entries.add(resolved);
  }

  return entries;
}

function resolveExplicitEntryPoint(
  rootDir: string,
  entryPoint: string,
  files: string[],
  extensions: string[],
): string | null {
  const base = path.resolve(rootDir, entryPoint);
  const candidates = resolveCandidates(base, extensions);
  for (const candidate of candidates) {
    if (files.includes(candidate)) return candidate;
  }
  return null;
}

function parseImportClause(clause: string): string[] {
  const trimmed = clause.replace(/\s+/g, ' ').trim();
  if (!trimmed) return [];
  if (trimmed.startsWith('type ')) return parseImportClause(trimmed.slice(5));

  const names = new Set<string>();

  const addDefault = (value: string) => {
    const name = value.trim();
    if (name && !name.startsWith('{') && !name.startsWith('*')) names.add('default');
  };

  if (trimmed.startsWith('{') && trimmed.endsWith('}')) {
    for (const item of splitNamedBindings(trimmed.slice(1, -1))) {
      const parsed = parseNamedBinding(item);
      if (parsed) names.add(parsed.importedName);
    }
    return [...names];
  }

  if (trimmed.startsWith('*')) {
    return [];
  }

  const commaIndex = trimmed.indexOf(',');
  if (commaIndex === -1) {
    addDefault(trimmed);
    return [...names];
  }

  addDefault(trimmed.slice(0, commaIndex));
  const remainder = trimmed.slice(commaIndex + 1).trim();
  if (remainder.startsWith('{') && remainder.endsWith('}')) {
    for (const item of splitNamedBindings(remainder.slice(1, -1))) {
      const parsed = parseNamedBinding(item);
      if (parsed) names.add(parsed.importedName);
    }
  }

  return [...names];
}

function splitNamedBindings(value: string): string[] {
  return value
    .split(',')
    .map((part) => part.trim())
    .filter(Boolean);
}

function parseNamedBinding(value: string): { importedName: string; exportedName: string } | null {
  const cleaned = value.replace(/^type\s+/u, '').trim();
  if (!cleaned) return null;
  const match = /^([A-Za-z_$][\w$]*)(?:\s+as\s+([A-Za-z_$][\w$]*))?$/u.exec(cleaned);
  if (!match) return null;
  const importedName = match[1];
  const exportedName = match[2] ?? importedName;
  return { importedName, exportedName };
}

function resolveModuleSpecifier(
  rootDir: string,
  importerFile: string,
  specifier: string,
  extensions: string[],
): string | null {
  if (!specifier.startsWith('.') && !specifier.startsWith('/')) return null;
  const base = specifier.startsWith('/')
    ? path.resolve(rootDir, `.${specifier}`)
    : path.resolve(path.dirname(importerFile), specifier);

  for (const candidate of resolveCandidates(base, extensions)) {
    if (fs.existsSync(candidate) && fs.statSync(candidate).isFile()) {
      return path.resolve(candidate);
    }
  }

  return null;
}

function resolveCandidates(basePath: string, extensions: string[]): string[] {
  const candidates = new Set<string>();
  const baseExtension = path.extname(basePath);

  candidates.add(basePath);

  if (!baseExtension) {
    for (const extension of extensions) {
      candidates.add(`${basePath}${extension}`);
      candidates.add(path.join(basePath, `index${extension}`));
    }
  } else if (RUNTIME_EXTENSIONS.includes(baseExtension)) {
    const stem = basePath.slice(0, -baseExtension.length);
    for (const extension of extensions) {
      candidates.add(`${stem}${extension}`);
    }
  }

  if (baseExtension) {
    const withoutExtension = basePath.slice(0, -baseExtension.length);
    for (const extension of extensions) {
      candidates.add(path.join(withoutExtension, `index${extension}`));
    }
  }

  return [...candidates];
}

function readGitignorePatterns(rootDir: string): string[] {
  const gitignorePath = path.join(rootDir, '.gitignore');
  if (!fs.existsSync(gitignorePath)) return [];

  return (
    safeRead(gitignorePath)
      ?.split(/\r?\n/u)
      .map((line) => line.trim())
      .filter((line) => line && !line.startsWith('#') && !line.startsWith('!')) ?? []
  );
}

function createLineLookup(content: string): number[] {
  const offsets = [0];
  for (let index = 0; index < content.length; index += 1) {
    if (content[index] === '\n') offsets.push(index + 1);
  }
  return offsets;
}

function lookupLine(offsets: number[], index: number): number {
  let low = 0;
  let high = offsets.length - 1;

  while (low <= high) {
    const mid = Math.floor((low + high) / 2);
    if (offsets[mid]! <= index) {
      low = mid + 1;
    } else {
      high = mid - 1;
    }
  }

  return high + 1;
}

function toRelativeFile(rootDir: string, file: string): string {
  return normalizeForMatch(path.relative(rootDir, file));
}

function normalizeForMatch(value: string): string {
  return value.replace(/\\/g, '/');
}

function safeRead(file: string): string | undefined {
  try {
    return fs.readFileSync(file, 'utf8');
  } catch {
    return undefined;
  }
}

function compareUnusedExports(left: UnusedExport, right: UnusedExport): number {
  return (
    left.file.localeCompare(right.file) ||
    left.line - right.line ||
    left.name.localeCompare(right.name)
  );
}
