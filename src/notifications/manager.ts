import type { NotificationHandler, NotificationConfig } from '../extensions/team.js';
import { SlackNotificationHandler } from '../extensions/slack-provider.js';
import { TeamsNotificationHandler } from '../extensions/teams-provider.js';
import { getNotificationHandler, registerNotificationHandler } from '../extensions/team.js';

const logDebug = (msg: string) => {
  if (process.env.ICOPILOT_LOG_LEVEL === 'debug') {
    process.stderr.write(`[notifications] ${msg}\n`);
  }
};

export class NotificationManager {
  private config: NotificationConfig | null;
  private handler: NotificationHandler | null = null;

  constructor(config?: NotificationConfig | null) {
    this.config = config ?? null;
    this.initializeHandler();
  }

  private initializeHandler(): void {
    if (!this.config || !this.config.token || !this.config.channel) {
      logDebug('No notification config provided');
      return;
    }

    try {
      let handler: NotificationHandler;

      if (this.config.provider === 'slack') {
        handler = new SlackNotificationHandler(this.config.token, this.config.channel);
        logDebug('Initialized Slack notification handler');
      } else if (this.config.provider === 'teams') {
        handler = new TeamsNotificationHandler(this.config.token, this.config.channel, '');
        logDebug('Initialized Teams notification handler');
      } else {
        logDebug(`Unknown notification provider: ${this.config.provider}`);
        return;
      }

      this.handler = handler;
      registerNotificationHandler(handler);
    } catch (error) {
      logDebug(`Failed to initialize notification handler: ${error}`);
    }
  }

  async sendNotification(
    message: string,
    options?: { channel?: string; metadata?: Record<string, unknown> },
  ): Promise<void> {
    if (!this.handler || !this.config) {
      logDebug('Notification handler not configured');
      return;
    }

    const channel = options?.channel || this.config.channel;

    try {
      await this.handler.notify(channel, message, options?.metadata);
      logDebug(`Sent notification to ${channel}`);
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      process.stderr.write(`[notifications] Failed to send notification: ${msg}\n`);
    }
  }

  async requestUserApproval(
    action: string,
    details: { description?: string; timeout?: number } = {},
  ): Promise<{ approved: boolean; approver?: string; timestamp?: string }> {
    if (!this.handler || !this.config) {
      logDebug('Notification handler not configured');
      return { approved: false };
    }

    try {
      const result = await this.handler.requestApproval(this.config.channel, action, details);
      logDebug(
        `Approval request completed: ${action} - ${result.approved ? 'approved' : 'denied'}`,
      );
      return result;
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      process.stderr.write(`[notifications] Failed to request approval: ${msg}\n`);
      return { approved: false };
    }
  }

  async getApprovalStatus(
    id: string,
  ): Promise<{ approved: boolean; approver?: string; timestamp?: string } | null> {
    return null;
  }

  formatOutput(content: string, type: 'text' | 'code' | 'error' = 'text'): string {
    if (type === 'error') {
      return `\`\`\`\n❌ Error:\n${content}\n\`\`\``;
    }
    if (type === 'code') {
      return `\`\`\`\n${content}\n\`\`\``;
    }
    return content;
  }

  async getStatus(): Promise<{ connected: boolean; error?: string }> {
    if (!this.handler) {
      return { connected: false, error: 'No handler configured' };
    }

    return this.handler.getStatus();
  }

  isConfigured(): boolean {
    return this.handler != null && this.config != null;
  }

  getConfig(): NotificationConfig | null {
    return this.config;
  }
}

let globalManager: NotificationManager | null = null;

export function initializeNotificationManager(config?: NotificationConfig | null): void {
  globalManager = new NotificationManager(config);
}

export function getNotificationManager(): NotificationManager {
  if (!globalManager) {
    globalManager = new NotificationManager(null);
  }
  return globalManager;
}
