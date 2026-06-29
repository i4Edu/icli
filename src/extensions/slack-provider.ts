import { randomUUID } from 'node:crypto';
import type { NotificationFormatter, NotificationHandler } from './team.js';

interface SlackBlockElement {
  type: string;
  [key: string]: unknown;
}

interface SlackBlock {
  type: string;
  [key: string]: unknown;
}

interface SlackMessage {
  channel: string;
  blocks?: SlackBlock[];
  text?: string;
  [key: string]: unknown;
}

interface PendingApproval {
  id: string;
  action: string;
  timeout: NodeJS.Timeout;
  resolve: (value: { approved: boolean; approver?: string; timestamp?: string }) => void;
}

export class SlackNotificationFormatter implements NotificationFormatter {
  formatText(message: string): Record<string, unknown> {
    return {
      type: 'section',
      text: {
        type: 'mrkdwn',
        text: message,
      },
    };
  }

  formatApprovalRequest(
    action: string,
    details: Record<string, unknown>,
  ): Record<string, unknown> {
    const blocks: SlackBlock[] = [
      {
        type: 'section',
        text: {
          type: 'mrkdwn',
          text: `🔐 *Approval Request* (ID: ${details.id || 'unknown'})`,
        },
      },
      {
        type: 'section',
        text: {
          type: 'mrkdwn',
          text: `*Action:* ${action}\n*Description:* ${details.description || 'N/A'}`,
        },
      },
      {
        type: 'actions',
        elements: [
          {
            type: 'button',
            text: { type: 'plain_text', text: 'Approve' },
            value: `approve-${details.id}`,
            action_id: `approve-${details.id}`,
            style: 'primary',
          },
          {
            type: 'button',
            text: { type: 'plain_text', text: 'Deny' },
            value: `deny-${details.id}`,
            action_id: `deny-${details.id}`,
            style: 'danger',
          },
        ],
      },
    ];

    if (details.timeout && typeof details.timeout === 'number') {
      const seconds = Math.ceil(details.timeout / 1000);
      blocks.push({
        type: 'context',
        elements: [
          {
            type: 'mrkdwn',
            text: `⏱️ Response required within ${seconds}s`,
          },
        ],
      });
    }

    return { blocks };
  }

  formatError(error: string): Record<string, unknown> {
    return {
      type: 'section',
      text: {
        type: 'mrkdwn',
        text: `⚠️ *Error:* ${error}`,
      },
    };
  }
}

export class SlackNotificationHandler implements NotificationHandler {
  private token: string;
  private channel: string;
  private apiUrl = 'https://slack.com/api';
  private formatter = new SlackNotificationFormatter();
  private pendingApprovals = new Map<string, PendingApproval>();
  private webhookHandlers = new Map<string, (actionId: string, approved: boolean) => void>();
  private _connected = false;

  constructor(token: string, channel: string) {
    this.token = token;
    this.channel = channel;
  }

  async notify(
    channel: string,
    message: string,
    metadata?: Record<string, unknown>,
  ): Promise<void> {
    const block = this.formatter.formatText(message);
    const payload: SlackMessage = {
      channel,
      blocks: [block as SlackBlock],
    };

    if (metadata?.threadTs && typeof metadata.threadTs === 'string') {
      payload.thread_ts = metadata.threadTs;
    }

    await this.callSlackApi('chat.postMessage', payload);
  }

  async requestApproval(
    channel: string,
    action: string,
    details: { description?: string; timeout?: number },
  ): Promise<{ approved: boolean; approver?: string; timestamp?: string }> {
    const id = randomUUID();
    const timeout = details.timeout ?? 5 * 60 * 1000;

    const formattedDetails: Record<string, unknown> = {
      id,
      description: details.description || 'Manual approval required',
    };

    if (timeout) {
      formattedDetails.timeout = timeout;
    }

    const formatted = this.formatter.formatApprovalRequest(action, formattedDetails);
    const payload: SlackMessage = {
      channel,
      ...(formatted as Record<string, unknown>),
    };

    await this.callSlackApi('chat.postMessage', payload);

    return new Promise<{ approved: boolean; approver?: string; timestamp?: string }>(
      (resolve) => {
        const timeoutHandle = setTimeout(() => {
          this.pendingApprovals.delete(id);
          resolve({ approved: false });
        }, timeout);

        const approval: PendingApproval = {
          id,
          action,
          timeout: timeoutHandle,
          resolve,
        };

        this.pendingApprovals.set(id, approval);
      },
    );
  }

  async getStatus(): Promise<{ connected: boolean; error?: string }> {
    try {
      const result = await this.callSlackApi('auth.test', {});
      this._connected = result.ok === true;
      return { connected: this._connected };
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      return { connected: false, error: msg };
    }
  }

  registerWebhook(url: string): void {
    process.env.ICOPILOT_SLACK_WEBHOOK_URL = url;
  }

  handleWebhookEvent(payload: Record<string, unknown>): void {
    const action = payload.actions as unknown[];
    if (!Array.isArray(action) || !action[0]) return;

    const firstAction = action[0] as Record<string, unknown>;
    const actionId = firstAction.action_id as string;
    if (!actionId || !actionId.startsWith('approve-') && !actionId.startsWith('deny-')) return;

    const approved = actionId.startsWith('approve-');
    const id = actionId.split('-')[1];

    const pending = this.pendingApprovals.get(id);
    if (!pending) return;

    clearTimeout(pending.timeout);
    this.pendingApprovals.delete(id);

    const user = (payload.user as Record<string, unknown>)?.id as string | undefined;
    pending.resolve({
      approved,
      approver: user,
      timestamp: new Date().toISOString(),
    });
  }

  private async callSlackApi(
    method: string,
    payload: Record<string, unknown>,
  ): Promise<Record<string, unknown>> {
    const url = `${this.apiUrl}/${method}`;

    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${this.token}`,
      },
      body: JSON.stringify(payload),
    });

    if (!response.ok) {
      throw new Error(`Slack API error: ${response.status} ${response.statusText}`);
    }

    const result = (await response.json()) as Record<string, unknown>;
    if (result.ok !== true) {
      const error = result.error as string | undefined;
      throw new Error(`Slack API error: ${error || 'unknown'}`);
    }

    return result;
  }
}
