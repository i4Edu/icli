import fs from 'node:fs';
import path from 'node:path';

const STATIC_IMPORT_RE = /\bimport\s+(?:type\s+)?(?:[\s\S]*?\s+from\s+)?['"]([^'"]+)['"]/g;
const DYNAMIC_IMPORT_RE = /\bimport\s*\(\s*['"]([^'"]+)['"]\s*\)/g;
const REQUIRE_RE = /\brequire\s*\(\s*['"]([^'"]+)['"]\s*\)/g;
const RESOLVABLE_EXTENSIONS = ['.ts', '.tsx', '.js', '.jsx'] as const;

export interface DependencyGraph {
  nodes: Map<string, string[]>;
}

interface DependencyResolverOptions {
  cwd?: string;
  tsconfigPath?: string;
}

interface TsConfigOptions {
  baseUrl?: string;
  paths: Record<string, string[]>;
  tsconfigDir: string;
}

interface RawTsConfig {
  extends?: string;
  compilerOptions?: {
    baseUrl?: string;
    paths?: Record<string, string[]>;
  };
}

export class DependencyResolver {
  private readonly cwd: string;

  private readonly tsconfigPath?: string;

  private readonly importCache = new Map<string, string[]>();

  private readonly nearestTsConfigCache = new Map<string, string | null>();

  private readonly tsConfigCache = new Map<string, TsConfigOptions>();

  constructor(options: DependencyResolverOptions = {}) {
    this.cwd = path.resolve(options.cwd ?? process.cwd());
    this.tsconfigPath = options.tsconfigPath
      ? path.resolve(this.cwd, options.tsconfigPath)
      : undefined;
  }

  resolveImports(filePath: string): string[] {
    const resolvedFile = this.resolveInputFile(filePath);
    if (!resolvedFile) return [];
    const cached = this.importCache.get(resolvedFile);
    if (cached) return [...cached];

    const source = this.readFile(resolvedFile);
    if (source === null) {
      this.importCache.set(resolvedFile, []);
      return [];
    }

    const imports = dedupe(
      extractImportSpecifiers(source)
        .map((specifier) => this.resolveSpecifier(specifier, resolvedFile))
        .filter((value): value is string => Boolean(value)),
    );

    this.importCache.set(resolvedFile, imports);
    return [...imports];
  }

  getRelatedFiles(filePath: string, depth = 1): string[] {
    if (depth < 1) return [];
    const entryFile = this.resolveInputFile(filePath);
    if (!entryFile) return [];

    const seen = new Set<string>([entryFile]);
    const related: string[] = [];

    const walk = (currentFile: string, remainingDepth: number): void => {
      if (remainingDepth < 1) return;
      for (const importedFile of this.resolveImports(currentFile)) {
        if (seen.has(importedFile)) continue;
        seen.add(importedFile);
        related.push(importedFile);
        walk(importedFile, remainingDepth - 1);
      }
    };

    walk(entryFile, depth);
    return related;
  }

  buildDependencyGraph(entryFile: string): DependencyGraph {
    const rootFile = this.resolveInputFile(entryFile);
    const nodes = new Map<string, string[]>();
    if (!rootFile) return { nodes };

    const visited = new Set<string>();
    const walk = (currentFile: string): void => {
      if (visited.has(currentFile)) return;
      visited.add(currentFile);

      const imports = this.resolveImports(currentFile);
      nodes.set(currentFile, imports);

      for (const importedFile of imports) {
        walk(importedFile);
      }
    };

    walk(rootFile);
    return { nodes };
  }

  private resolveInputFile(filePath: string): string | null {
    const absolutePath = path.isAbsolute(filePath) ? filePath : path.resolve(this.cwd, filePath);
    return this.resolveWithExtensions(absolutePath);
  }

  private resolveSpecifier(specifier: string, importerFile: string): string | null {
    if (!specifier) return null;

    if (specifier.startsWith('.') || path.isAbsolute(specifier)) {
      return this.resolveWithExtensions(path.resolve(path.dirname(importerFile), specifier));
    }

    const tsConfig = this.getTsConfigForFile(importerFile);
    if (tsConfig) {
      for (const [pattern, targets] of Object.entries(tsConfig.paths)) {
        const match = matchPathAlias(specifier, pattern);
        if (!match.matches) continue;

        for (const target of targets) {
          const replaced = target.includes('*') ? target.replace('*', match.value) : target;
          const candidate = path.resolve(tsConfig.baseUrl ?? tsConfig.tsconfigDir, replaced);
          const resolved = this.resolveWithExtensions(candidate);
          if (resolved) return resolved;
        }
      }
    }

    return isNodeModulesSpecifier(specifier) ? null : this.resolveWithExtensions(specifier);
  }

  private resolveWithExtensions(candidatePath: string): string | null {
    const normalizedPath = path.resolve(candidatePath);
    if (normalizedPath.includes(`${path.sep}node_modules${path.sep}`)) return null;

    const candidates = new Set<string>();
    const extension = path.extname(normalizedPath);
    const basePath = extension ? normalizedPath.slice(0, -extension.length) : normalizedPath;

    candidates.add(normalizedPath);

    if (extension) {
      for (const knownExtension of RESOLVABLE_EXTENSIONS) {
        candidates.add(`${basePath}${knownExtension}`);
      }
    } else {
      for (const knownExtension of RESOLVABLE_EXTENSIONS) {
        candidates.add(`${normalizedPath}${knownExtension}`);
      }
    }

    for (const knownExtension of RESOLVABLE_EXTENSIONS) {
      candidates.add(path.join(normalizedPath, `index${knownExtension}`));
      if (extension) {
        candidates.add(path.join(basePath, `index${knownExtension}`));
      }
    }

    for (const candidate of candidates) {
      try {
        if (fs.statSync(candidate).isFile()) {
          return path.resolve(candidate);
        }
      } catch {
        // Ignore missing candidates.
      }
    }

    return null;
  }

  private getTsConfigForFile(filePath: string): TsConfigOptions | null {
    const tsconfigPath = this.findNearestTsConfig(path.dirname(filePath));
    if (!tsconfigPath) return null;
    return this.loadTsConfig(tsconfigPath);
  }

  private findNearestTsConfig(startDir: string): string | null {
    if (this.tsconfigPath) return fs.existsSync(this.tsconfigPath) ? this.tsconfigPath : null;
    const normalizedStart = path.resolve(startDir);
    const cached = this.nearestTsConfigCache.get(normalizedStart);
    if (cached !== undefined) return cached;

    let currentDir = normalizedStart;
    // eslint-disable-next-line no-constant-condition
    while (true) {
      const candidate = path.join(currentDir, 'tsconfig.json');
      if (fs.existsSync(candidate) && fs.statSync(candidate).isFile()) {
        this.nearestTsConfigCache.set(normalizedStart, candidate);
        return candidate;
      }

      const parentDir = path.dirname(currentDir);
      if (parentDir === currentDir) break;
      currentDir = parentDir;
    }

    this.nearestTsConfigCache.set(normalizedStart, null);
    return null;
  }

  private loadTsConfig(tsconfigPath: string): TsConfigOptions {
    const normalizedPath = path.resolve(tsconfigPath);
    const cached = this.tsConfigCache.get(normalizedPath);
    if (cached) return cached;

    const loaded = this.loadRawTsConfig(normalizedPath, new Set<string>());
    const compilerOptions = loaded.compilerOptions ?? {};
    const options: TsConfigOptions = {
      baseUrl: compilerOptions.baseUrl
        ? path.resolve(path.dirname(normalizedPath), compilerOptions.baseUrl)
        : undefined,
      paths: compilerOptions.paths ?? {},
      tsconfigDir: path.dirname(normalizedPath),
    };

    this.tsConfigCache.set(normalizedPath, options);
    return options;
  }

  private loadRawTsConfig(tsconfigPath: string, visited: Set<string>): RawTsConfig {
    const normalizedPath = path.resolve(tsconfigPath);
    if (visited.has(normalizedPath)) return {};
    visited.add(normalizedPath);

    const localConfig = parseJsoncFile<RawTsConfig>(normalizedPath) ?? {};
    const inheritedPath = resolveExtendsPath(localConfig.extends, normalizedPath);
    if (!inheritedPath) return localConfig;

    const parentConfig = this.loadRawTsConfig(inheritedPath, visited);
    return mergeTsConfigs(parentConfig, localConfig);
  }

  private readFile(filePath: string): string | null {
    try {
      return fs.readFileSync(filePath, 'utf8');
    } catch {
      return null;
    }
  }
}

function extractImportSpecifiers(source: string): string[] {
  const specifiers: string[] = [];
  collectMatches(STATIC_IMPORT_RE, source, specifiers);
  collectMatches(DYNAMIC_IMPORT_RE, source, specifiers);
  collectMatches(REQUIRE_RE, source, specifiers);
  return specifiers;
}

function collectMatches(pattern: RegExp, source: string, output: string[]): void {
  pattern.lastIndex = 0;
  let match: RegExpExecArray | null;
  while ((match = pattern.exec(source))) {
    output.push(match[1]);
  }
}

function dedupe(values: string[]): string[] {
  return [...new Set(values)];
}

function isNodeModulesSpecifier(specifier: string): boolean {
  return !specifier.startsWith('.') && !path.isAbsolute(specifier);
}

function matchPathAlias(specifier: string, pattern: string): { matches: boolean; value: string } {
  if (!pattern.includes('*')) {
    return { matches: specifier === pattern, value: '' };
  }

  const [prefix, suffix] = pattern.split('*');
  if (!specifier.startsWith(prefix) || !specifier.endsWith(suffix)) {
    return { matches: false, value: '' };
  }

  return {
    matches: true,
    value: specifier.slice(prefix.length, specifier.length - suffix.length),
  };
}

function parseJsoncFile<T>(filePath: string): T | null {
  try {
    const raw = fs.readFileSync(filePath, 'utf8');
    return JSON.parse(stripTrailingCommas(stripJsonComments(raw))) as T;
  } catch {
    return null;
  }
}

function stripJsonComments(input: string): string {
  let output = '';
  let inString = false;
  let stringDelimiter = '';
  let escapeNext = false;
  let i = 0;

  while (i < input.length) {
    const current = input[i];
    const next = input[i + 1];

    if (inString) {
      output += current;
      if (escapeNext) {
        escapeNext = false;
      } else if (current === '\\') {
        escapeNext = true;
      } else if (current === stringDelimiter) {
        inString = false;
        stringDelimiter = '';
      }
      i += 1;
      continue;
    }

    if (current === '"' || current === "'") {
      inString = true;
      stringDelimiter = current;
      output += current;
      i += 1;
      continue;
    }

    if (current === '/' && next === '/') {
      while (i < input.length && input[i] !== '\n') i += 1;
      continue;
    }

    if (current === '/' && next === '*') {
      i += 2;
      while (i < input.length && !(input[i] === '*' && input[i + 1] === '/')) i += 1;
      i += 2;
      continue;
    }

    output += current;
    i += 1;
  }

  return output;
}

function stripTrailingCommas(input: string): string {
  return input.replace(/,\s*([}\]])/g, '$1');
}

function resolveExtendsPath(extendsValue: string | undefined, tsconfigPath: string): string | null {
  if (!extendsValue) return null;
  if (!extendsValue.startsWith('.') && !path.isAbsolute(extendsValue)) return null;
  const candidate = path.isAbsolute(extendsValue)
    ? extendsValue
    : path.resolve(path.dirname(tsconfigPath), extendsValue);

  if (fs.existsSync(candidate) && fs.statSync(candidate).isFile()) return candidate;
  const withJsonExtension = candidate.endsWith('.json') ? candidate : `${candidate}.json`;
  if (fs.existsSync(withJsonExtension) && fs.statSync(withJsonExtension).isFile())
    return withJsonExtension;
  return null;
}

function mergeTsConfigs(baseConfig: RawTsConfig, overrideConfig: RawTsConfig): RawTsConfig {
  return {
    ...baseConfig,
    ...overrideConfig,
    compilerOptions: {
      ...(baseConfig.compilerOptions ?? {}),
      ...(overrideConfig.compilerOptions ?? {}),
      paths: {
        ...(baseConfig.compilerOptions?.paths ?? {}),
        ...(overrideConfig.compilerOptions?.paths ?? {}),
      },
    },
  };
}
