import fs from 'node:fs';
import path from 'node:path';
import fg from 'fast-glob';

export interface Location {
  file: string;
  line: number;
  column?: number;
  context: string;
}

const SOURCE_PATTERNS = ['**/*.{ts,tsx,mts,cts,js,jsx,mjs,cjs}'];
const DEFAULT_IGNORES = ['**/node_modules/**', '**/dist/**', '**/.git/**', '**/coverage/**', '**/*.d.ts'];

export function goToDefinition(symbolName: string, rootDir: string): Location | null {
  const escapedSymbol = escapeRegex(symbolName.trim());
  if (!escapedSymbol) return null;

  const declarationRegex = new RegExp(
    String.raw`^\s*export\s+(?:default\s+)?(?:async\s+)?(?:function|class|const|type|interface)\s+(${escapedSymbol})\b`,
  );
  const assignmentRegex = new RegExp(String.raw`\b(${escapedSymbol})\b\s*=(?!=)`);

  for (const file of listSourceFiles(rootDir)) {
    const content = safeRead(file);
    if (content === undefined) continue;

    const lines = content.split(/\r?\n/u);
    for (let index = 0; index < lines.length; index += 1) {
      const line = lines[index] ?? '';
      const declarationMatch = declarationRegex.exec(line);
      if (declarationMatch) {
        return createLocation(file, rootDir, index + 1, declarationMatch.index + declarationMatch[0].indexOf(declarationMatch[1]!), line);
      }

      const assignmentMatch = assignmentRegex.exec(line);
      if (assignmentMatch) {
        return createLocation(file, rootDir, index + 1, assignmentMatch.index, line);
      }
    }
  }

  return null;
}

export function findReferences(symbolName: string, rootDir: string): Location[] {
  const escapedSymbol = escapeRegex(symbolName.trim());
  if (!escapedSymbol) return [];

  const referenceRegex = new RegExp(String.raw`\b${escapedSymbol}\b`, 'g');
  const locations: Location[] = [];

  for (const file of listSourceFiles(rootDir)) {
    const content = safeRead(file);
    if (content === undefined) continue;

    const lines = content.split(/\r?\n/u);
    for (let index = 0; index < lines.length; index += 1) {
      const line = lines[index] ?? '';
      if (isDefinitionLine(line, escapedSymbol)) continue;

      referenceRegex.lastIndex = 0;
      let match = referenceRegex.exec(line);
      while (match) {
        locations.push(createLocation(file, rootDir, index + 1, match.index, line));
        match = referenceRegex.exec(line);
      }
    }
  }

  return sortLocations(locations);
}

export function findImplementations(interfaceName: string, rootDir: string): Location[] {
  const escapedSymbol = escapeRegex(interfaceName.trim());
  if (!escapedSymbol) return [];

  const implementsRegex = new RegExp(
    String.raw`\bclass\s+[A-Za-z_$][\w$]*\b[^{\n]*\bimplements\b[^{\n]*\b(${escapedSymbol})\b`,
  );
  const extendsRegex = new RegExp(String.raw`\bclass\s+[A-Za-z_$][\w$]*\b[^{\n]*\bextends\s+(${escapedSymbol})\b`);
  const locations: Location[] = [];

  for (const file of listSourceFiles(rootDir)) {
    const content = safeRead(file);
    if (content === undefined) continue;

    const lines = content.split(/\r?\n/u);
    for (let index = 0; index < lines.length; index += 1) {
      const line = lines[index] ?? '';
      const match = implementsRegex.exec(line) ?? extendsRegex.exec(line);
      if (!match) continue;
      locations.push(createLocation(file, rootDir, index + 1, match.index + match[0].lastIndexOf(match[1]!), line));
    }
  }

  return sortLocations(locations);
}

function listSourceFiles(rootDir: string): string[] {
  const normalizedRoot = path.resolve(rootDir);
  return fg
    .sync(SOURCE_PATTERNS, {
      cwd: normalizedRoot,
      onlyFiles: true,
      absolute: true,
      unique: true,
      dot: false,
      ignore: [...DEFAULT_IGNORES, ...readGitignorePatterns(normalizedRoot)],
    })
    .map((file) => path.resolve(file))
    .sort((left, right) => left.localeCompare(right));
}

function readGitignorePatterns(rootDir: string): string[] {
  const gitignorePath = path.join(rootDir, '.gitignore');
  if (!fs.existsSync(gitignorePath)) return [];

  return (
    safeRead(gitignorePath)
      ?.split(/\r?\n/u)
      .map((line) => line.trim())
      .filter((line) => line && !line.startsWith('#') && !line.startsWith('!'))
      .flatMap((line) => {
        const normalized = line.replace(/^\.\//u, '').replace(/^\/+/u, '');
        if (normalized.endsWith('/')) return [normalized, `${normalized}**`];
        return [normalized];
      }) ?? []
  );
}

function isDefinitionLine(line: string, escapedSymbol: string): boolean {
  const declarationRegex = new RegExp(
    String.raw`^\s*export\s+(?:default\s+)?(?:async\s+)?(?:function|class|const|type|interface)\s+${escapedSymbol}\b`,
  );
  const assignmentRegex = new RegExp(String.raw`\b${escapedSymbol}\b\s*=(?!=)`);
  return declarationRegex.test(line) || assignmentRegex.test(line);
}

function createLocation(file: string, rootDir: string, line: number, zeroBasedColumn: number, context: string): Location {
  return {
    file: path.relative(rootDir, file),
    line,
    column: zeroBasedColumn + 1,
    context: context.trim(),
  };
}

function sortLocations(locations: Location[]): Location[] {
  return locations.sort(
    (left, right) =>
      left.file.localeCompare(right.file) ||
      left.line - right.line ||
      (left.column ?? 0) - (right.column ?? 0),
  );
}

function safeRead(file: string): string | undefined {
  try {
    return fs.readFileSync(file, 'utf8');
  } catch {
    return undefined;
  }
}

function escapeRegex(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
