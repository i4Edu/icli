import fs from 'node:fs';
import path from 'node:path';
import { ConventionManager, listConventionFiles, resolveConventionPath, type ConventionViolation } from '../knowledge/conventions.js';
import { theme } from '../ui/theme.js';

export function conventionsCommand(args: string[], cwd: string): string {
  const manager = new ConventionManager();
  const [rawSubcommand = 'list', ...rest] = args;
  const subcommand = rawSubcommand.toLowerCase();

  try {
    switch (subcommand) {
      case 'list':
      case 'show':
      case 'current':
        return listConventions(manager, cwd);
      case 'detect':
        return detectConventions(manager, cwd);
      case 'check':
        return checkConventions(manager, cwd, rest);
      case 'add':
        return addConvention(manager, cwd, rest);
      default:
        return usage();
    }
  } catch (error) {
    return theme.err(`conventions: ${(error as Error).message}\n`);
  }
}

function listConventions(manager: ConventionManager, cwd: string): string {
  const set = manager.load(cwd);
  if (set.conventions.length === 0) {
    return `${theme.brand('Conventions')}\n  ${theme.dim('No saved conventions. Run /conventions detect or /conventions add first.')}\n`;
  }

  return `${theme.brand(`Conventions ${theme.dim(`(${set.name})`)}`)}\n${set.conventions
    .map(
      (convention) =>
        `  ${theme.hl(convention.name)} ${theme.dim(`[${convention.severity}]`)}\n    ${convention.rule}${convention.example ? ` ${theme.dim(`e.g. ${convention.example}`)}` : ''}`,
    )
    .join('\n')}\n`;
}

function detectConventions(manager: ConventionManager, cwd: string): string {
  manager.load(cwd);
  const detected = manager.detect(cwd);
  if (detected.length === 0) {
    return `${theme.brand('Conventions')}\n  ${theme.dim('No source patterns detected.')}\n`;
  }

  for (const convention of detected) {
    manager.add(convention);
  }
  manager.save(cwd);

  return [
    `${theme.ok('✔ detected conventions')} ${theme.dim(`(${detected.length})`)} ${theme.hl(resolveConventionPath(cwd))}`,
    ...detected.map((convention) => `  - ${theme.hl(convention.name)} ${theme.dim(`[${convention.severity}]`)} — ${convention.rule}`),
    '',
  ].join('\n');
}

function checkConventions(manager: ConventionManager, cwd: string, args: string[]): string {
  const set = manager.load(cwd);
  if (set.conventions.length === 0) {
    const detected = manager.detect(cwd);
    for (const convention of detected) {
      manager.add(convention);
    }
    if (manager.getConventionSet().conventions.length === 0) {
      return `${theme.brand('Convention check')}\n  ${theme.dim('No conventions available. Run /conventions detect or /conventions add first.')}\n`;
    }
  }

  const target = args.join(' ').trim();
  const files = target ? [resolveTargetFile(cwd, target)] : listConventionFiles(cwd);
  if (files.length === 0) {
    return `${theme.brand('Convention check')}\n  ${theme.dim('No files found to check.')}\n`;
  }

  const violations = files.flatMap((file) => {
    const code = fs.readFileSync(file, 'utf8');
    return manager.check(code).map((violation) => ({
      ...violation,
      file,
    }));
  });

  if (violations.length === 0) {
    return `${theme.ok('✔ no convention violations found')}${target ? ` ${theme.dim(path.relative(cwd, files[0] ?? target))}` : ''}\n`;
  }

  return [
    `${theme.warn(`Found ${violations.length} convention violation${violations.length === 1 ? '' : 's'}.`)}`,
    ...violations.map((violation) => formatViolation(cwd, violation)),
    '',
  ].join('\n');
}

function addConvention(manager: ConventionManager, cwd: string, args: string[]): string {
  const [name, ...ruleParts] = args;
  const rule = ruleParts.join(' ').trim();
  if (!name || !rule) return theme.warn('usage: /conventions add <name> <rule>\n');

  manager.load(cwd);
  manager.add({
    id: name,
    name,
    description: `User-defined convention: ${name}`,
    rule,
    severity: 'recommended',
  });
  manager.save(cwd);

  return `${theme.ok('✔ saved convention')} ${theme.hl(name)} ${theme.dim('→')} ${rule}\n`;
}

function resolveTargetFile(cwd: string, target: string): string {
  const resolved = path.resolve(cwd, target);
  if (!fs.existsSync(resolved) || !fs.statSync(resolved).isFile()) {
    throw new Error(`file not found: ${resolved}`);
  }
  return resolved;
}

function formatViolation(cwd: string, violation: ConventionViolation): string {
  const relativePath = violation.file ? path.relative(cwd, violation.file) : '(input)';
  const location = violation.line ? `${relativePath}:${violation.line}` : relativePath;
  return `  ${theme.hl(location)} ${theme.dim(`(${violation.convention.name})`)} ${violation.description}`;
}

function usage(): string {
  return theme.warn('usage: /conventions [list|detect|check [file]|add <name> <rule>]\n');
}
