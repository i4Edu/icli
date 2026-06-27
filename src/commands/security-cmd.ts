import fs from 'node:fs';
import path from 'node:path';
import fg from 'fast-glob';
import { theme } from '../ui/theme.js';

export interface SecurityFinding {
  file: string;
  line: number;
  pattern: string;
  severity: 'high' | 'medium' | 'low';
  description: string;
}

export const SCANNABLE_EXTENSIONS: string[] = [
  '.ts',
  '.js',
  '.py',
  '.env',
  '.yml',
  '.yaml',
  '.json',
  '.toml',
  '.cfg',
  '.ini',
  '.conf',
  '.sh',
  '.bash',
  '.rb',
  '.go',
  '.java',
  '.cs',
  '.php',
];

type Severity = SecurityFinding['severity'];

type SecurityPattern = {
  name: string;
  regex: RegExp;
  severity: Severity;
  description: string;
};

const MAX_FILES = 1000;
const MAX_LINES = 500;

const SECURITY_PATTERNS: SecurityPattern[] = [
  {
    name: 'AWS key',
    regex: /AKIA[0-9A-Z]{16}/,
    severity: 'high',
    description: 'Possible AWS access key exposed in source.',
  },
  {
    name: 'Private key',
    regex: /-----BEGIN (?:RSA |EC |DSA )?PRIVATE KEY-----/,
    severity: 'high',
    description: 'Private key material should never be committed.',
  },
  {
    name: 'GitHub token',
    regex: /gh[pousr]_[A-Za-z0-9_]{36,}/,
    severity: 'high',
    description: 'Possible GitHub token found in a tracked file.',
  },
  {
    name: 'Password in code',
    regex: /(?:password|passwd|pwd)\s*[:=]\s*['"][^'"]{4,}/i,
    severity: 'medium',
    description: 'Literal password-like value detected in code or config.',
  },
  {
    name: 'API key',
    regex: /(?:api[_-]?key|apikey)\s*[:=]\s*['"][A-Za-z0-9]{20,}/i,
    severity: 'medium',
    description: 'API key assignment detected; consider environment-based secrets.',
  },
  {
    name: 'Generic secret',
    regex: /(?:secret|token)\s*[:=]\s*['"][A-Za-z0-9+/=]{20,}/i,
    severity: 'low',
    description: 'Secret or token-like literal detected.',
  },
];

function isEnvFile(filePath: string): boolean {
  const baseName = path.basename(filePath).toLowerCase();
  return baseName === '.env' || baseName.startsWith('.env.');
}

function isScannableFile(filePath: string): boolean {
  if (isEnvFile(filePath)) return true;
  return SCANNABLE_EXTENSIONS.includes(path.extname(filePath).toLowerCase());
}

function readLines(filePath: string): string[] {
  try {
    return fs.readFileSync(filePath, 'utf8').split(/\r?\n/).slice(0, MAX_LINES);
  } catch {
    return [];
  }
}

function listCandidateFiles(cwd: string): string[] {
  return fg
    .sync('**/*', {
      cwd,
      absolute: true,
      onlyFiles: true,
      dot: true,
      ignore: ['**/node_modules/**', '**/.git/**', '**/dist/**'],
    })
    .filter(isScannableFile)
    .slice(0, MAX_FILES);
}

export function scanFilesForSecrets(cwd: string, relativePaths: string[]): SecurityFinding[] {
  if (!fs.existsSync(cwd) || !fs.statSync(cwd).isDirectory()) return [];

  const findings: SecurityFinding[] = [];

  for (const relativePath of relativePaths) {
    const normalizedRelativePath = path.normalize(relativePath);
    const filePath = path.join(cwd, normalizedRelativePath);
    if (!isScannableFile(filePath) || !fs.existsSync(filePath) || !fs.statSync(filePath).isFile()) {
      continue;
    }
    const lines = readLines(filePath);

    lines.forEach((lineText, index) => {
      for (const pattern of SECURITY_PATTERNS) {
        if (pattern.regex.test(lineText)) {
          findings.push({
            file: normalizedRelativePath,
            line: index + 1,
            pattern: pattern.name,
            severity: pattern.severity,
            description: pattern.description,
          });
        }
      }
    });
  }

  return findings;
}

export function scanForSecrets(cwd: string): SecurityFinding[] {
  return scanFilesForSecrets(
    cwd,
    listCandidateFiles(cwd).map((filePath) => path.relative(cwd, filePath)),
  );
}

function severityColor(severity: Severity): (text: string) => string {
  switch (severity) {
    case 'high':
      return theme.err;
    case 'medium':
      return theme.warn;
    case 'low':
      return theme.dim;
  }
}

function formatGroup(severity: Severity, findings: SecurityFinding[]): string {
  if (findings.length === 0) return '';

  const color = severityColor(severity);
  const title = color(`${severity.toUpperCase()} (${findings.length})`);
  const lines = findings.map(
    (finding) =>
      `  ${color(finding.file)}:${finding.line}  ${finding.pattern}  ${theme.dim(`- ${finding.description}`)}`,
  );

  return `${title}\n${lines.join('\n')}`;
}

export function securityCommand(cwd: string): string {
  const findings = scanForSecrets(cwd);

  if (findings.length === 0) {
    return `${theme.ok('No obvious security issues detected.')}\n${theme.dim(
      'Scanned common secret and credential patterns in source files.',
    )}\n`;
  }

  const grouped = {
    high: findings.filter((finding) => finding.severity === 'high'),
    medium: findings.filter((finding) => finding.severity === 'medium'),
    low: findings.filter((finding) => finding.severity === 'low'),
  };

  const sections = (['high', 'medium', 'low'] as Severity[])
    .map((severity) => formatGroup(severity, grouped[severity]))
    .filter(Boolean);

  return `${theme.brand('Security findings')}\n${sections.join('\n\n')}\n`;
}
