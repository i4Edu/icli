import fs from 'node:fs';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  SCANNABLE_EXTENSIONS,
  scanForSecrets,
  securityCommand,
} from '../../src/commands/security-cmd.js';

let tmpRoot: string;
let tmpDir: string;

beforeEach(() => {
  tmpRoot = path.join(process.cwd(), '.vitest-security-cmd-tmp');
  fs.mkdirSync(tmpRoot, { recursive: true });
  tmpDir = fs.mkdtempSync(path.join(tmpRoot, 'case-'));
});

afterEach(() => {
  fs.rmSync(tmpRoot, { recursive: true, force: true });
});

function writeFixture(relativePath: string, content: string): void {
  const filePath = path.join(tmpDir, relativePath);
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, content);
}

describe('scanForSecrets', () => {
  it('returns no findings for clean files', () => {
    writeFixture('src/app.ts', 'export const message = "hello";\n');
    writeFixture('.env.example', 'LOG_LEVEL=debug\n');

    expect(scanForSecrets(tmpDir)).toEqual([]);
  });

  it('detects all configured secret patterns', () => {
    writeFixture(
      'src/secrets.ts',
      [
        'const api_key = "ABCDEFGHIJKLMNOPQRSTUV";',
        'const aws = "AKIA1234567890ABCDEF";',
        'const privateKey = "-----BEGIN PRIVATE KEY-----";',
        'const password = "super-secret-password";',
        'const gh = "ghp_abcdefghijklmnopqrstuvwxyz1234567890ABCDEF";',
        'const token = "AbCdEfGhIjKlMnOpQrStUvWxYz012345";',
      ].join('\n'),
    );

    const findings = scanForSecrets(tmpDir);

    expect(findings).toHaveLength(6);
    expect(findings).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ line: 1, pattern: 'API key', severity: 'medium' }),
        expect.objectContaining({ line: 2, pattern: 'AWS key', severity: 'high' }),
        expect.objectContaining({ line: 3, pattern: 'Private key', severity: 'high' }),
        expect.objectContaining({ line: 4, pattern: 'Password in code', severity: 'medium' }),
        expect.objectContaining({ line: 5, pattern: 'GitHub token', severity: 'high' }),
        expect.objectContaining({ line: 6, pattern: 'Generic secret', severity: 'low' }),
      ]),
    );
  });

  it('skips ignored directories and non-scannable files', () => {
    writeFixture('node_modules/leak.js', 'const token = "AbCdEfGhIjKlMnOpQrStUvWxYz012345";\n');
    writeFixture('.git/config.json', '{"api_key":"ABCDEFGHIJKLMNOPQRSTUV"}\n');
    writeFixture('dist/build.js', 'const password = "secret1234";\n');
    writeFixture('assets/image.bin', 'ghp_abcdefghijklmnopqrstuvwxyz1234567890ABCDEF');

    expect(scanForSecrets(tmpDir)).toEqual([]);
  });

  it('ignores findings beyond the first 500 lines of a file', () => {
    const lines = Array.from({ length: 500 }, () => 'const safe = "value";');
    lines.push('const token = "AbCdEfGhIjKlMnOpQrStUvWxYz012345";');
    writeFixture('src/long-file.ts', lines.join('\n'));

    expect(scanForSecrets(tmpDir)).toEqual([]);
  });

  it('formats findings by severity', () => {
    writeFixture('config/.env', 'token="AbCdEfGhIjKlMnOpQrStUvWxYz012345"\n');
    writeFixture('src/app.ts', 'const password = "secret1234";\n');

    const output = securityCommand(tmpDir);

    expect(output).toContain('Security findings');
    expect(output).toContain('MEDIUM');
    expect(output).toContain('LOW');
    expect(output).toContain('app.ts:1');
    expect(output).toContain('.env:1');
  });

  it('exports the configured extension list', () => {
    expect(SCANNABLE_EXTENSIONS).toEqual(
      expect.arrayContaining(['.ts', '.js', '.py', '.env', '.yaml', '.json', '.php']),
    );
  });
});
