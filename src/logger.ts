import { config, type LogLevel } from './config.js';

const LEVELS: Record<LogLevel, number> = {
  debug: 10,
  info: 20,
  warn: 30,
  error: 40,
};

export class Logger {
  redact(text: string): string {
    return text
      .replace(/ghp_[A-Za-z0-9_]{20,}/g, '***REDACTED***')
      .replace(/gho_[A-Za-z0-9_]{20,}/g, '***REDACTED***')
      .replace(/Bearer\s+[A-Za-z0-9._-]+/g, 'Bearer ***REDACTED***')
      .replace(/(?<="token":")[^"]+/g, '***REDACTED***');
  }

  debug(message: string, fields?: Record<string, unknown>): void {
    this.write('debug', message, fields);
  }

  info(message: string, fields?: Record<string, unknown>): void {
    this.write('info', message, fields);
  }

  warn(message: string, fields?: Record<string, unknown>): void {
    this.write('warn', message, fields);
  }

  error(message: string, fields?: Record<string, unknown>): void {
    this.write('error', message, fields);
  }

  private write(level: LogLevel, message: string, fields?: Record<string, unknown>): void {
    if (LEVELS[level] < LEVELS[config.logLevel]) return;
    const suffix = fields ? ` ${this.redact(JSON.stringify(fields))}` : '';
    process.stderr.write(
      `[${new Date().toISOString()}] ${level.toUpperCase()} ${this.redact(message)}${suffix}\n`,
    );
  }
}

export const logger = new Logger();
