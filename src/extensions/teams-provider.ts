import { randomUUID } from 'node:crypto';
import type { NotificationFormatter, NotificationHandler } from './team.js';

interface AdaptiveCardAction {
  type: string;
  title: string;
  id: string;
  style?: string;
}

interface AdaptiveCard {
  type: string;
  body: unknown[];
  actions?: AdaptiveCardAction[];
  [key: string]: unknown;
}

interface TeamsMessage {
  type: string;
  from: { id: string };
  conversation: { id: string };
  attachments?: Array<{ contentType: string; contentUrl?: string; content?: unknown }>;
  [key: string]: unknown;
}

interface PendingApproval {
  id: string;
  action: string;
  timeout: NodeJS.Timeout;
  resolve: (value: { approved: boolean; approver?: string; timestamp?: string }) => void;
}

export class TeamsNotificationFormatter implements NotificationFormatter {
  formatText(message: string): Record<string, unknown> {
    return {
      type: 'AdaptiveCard',
      body: [
        {
          type: 'TextBlock',
          text: message,
          wrap: true,
          spacing: 'Large',
        },
      ],
    };
  }

  formatApprovalRequest(action: string, details: Record<string, unknown>): Record<string, unknown> {
    const card: AdaptiveCard = {
      type: 'AdaptiveCard',
      body: [
        {
          type: 'TextBlock',
          text: '🔐 Approval Request',
          weight: 'bolder',
          size: 'large',
        },
        {
          type: 'FactSet',
          facts: [
            {
              name: 'Action',
              value: action,
            },
            {
              name: 'Description',
              value: (details.description as string) || 'N/A',
            },
            {
              name: 'ID',
              value: (details.id as string) || 'unknown',
            },
          ],
        },
      ],
      actions: [
        {
          type: 'Action.OpenUrl',
          title: 'Approve',
          url: `${details.approveUrl || ''}`,
          style: 'positive',
        } as unknown as AdaptiveCardAction,
        {
          type: 'Action.OpenUrl',
          title: 'Deny',
          url: `${details.denyUrl || ''}`,
          style: 'destructive',
        } as unknown as AdaptiveCardAction,
      ],
    };

    if (details.timeout && typeof details.timeout === 'number') {
      const seconds = Math.ceil((details.timeout as number) / 1000);
      (card.body as unknown[]).push({
        type: 'TextBlock',
        text: `⏱️ Response required within ${seconds}s`,
        spacing: 'Large',
        color: 'warning',
      });
    }

    return card;
  }

  formatError(error: string): Record<string, unknown> {
    return {
      type: 'AdaptiveCard',
      body: [
        {
          type: 'TextBlock',
          text: `⚠️ Error: ${error}`,
          wrap: true,
          color: 'attention',
          weight: 'bolder',
        },
      ],
    };
  }
}

export class TeamsNotificationHandler implements NotificationHandler {
  private appId: string;
  private appPassword: string;
  private channelId: string;
  private formatter = new TeamsNotificationFormatter();
  private pendingApprovals = new Map<string, PendingApproval>();
  private _connected = false;

  constructor(appId: string, appPassword: string, channelId: string) {
    this.appId = appId;
    this.appPassword = appPassword;
    this.channelId = channelId;
  }

  async notify(
    channel: string,
    message: string,
    metadata?: Record<string, unknown>,
  ): Promise<void> {
    const card = this.formatter.formatText(message);

    const payload: TeamsMessage = {
      type: 'message',
      from: { id: this.appId },
      conversation: { id: channel },
      attachments: [
        {
          contentType: 'application/vnd.microsoft.card.adaptive',
          content: card,
        },
      ],
    };

    if (metadata?.replyToId && typeof metadata.replyToId === 'string') {
      payload.replyToId = metadata.replyToId;
    }

    await this.callTeamsApi(channel, payload);
  }

  async requestApproval(
    channel: string,
    action: string,
    details: { description?: string; timeout?: number },
  ): Promise<{ approved: boolean; approver?: string; timestamp?: string }> {
    const id = randomUUID();
    const timeout = details.timeout ?? 5 * 60 * 1000;

    const webhookUrl = process.env.ICOPILOT_TEAMS_WEBHOOK_URL || '';
    const baseUrl = webhookUrl.split('/connectors/')[0];

    const formattedDetails: Record<string, unknown> = {
      id,
      description: details.description || 'Manual approval required',
      approveUrl: `${baseUrl}/approve?id=${id}`,
      denyUrl: `${baseUrl}/deny?id=${id}`,
    };

    if (timeout) {
      formattedDetails.timeout = timeout;
    }

    const card = this.formatter.formatApprovalRequest(action, formattedDetails);

    const payload: TeamsMessage = {
      type: 'message',
      from: { id: this.appId },
      conversation: { id: channel },
      attachments: [
        {
          contentType: 'application/vnd.microsoft.card.adaptive',
          content: card,
        },
      ],
    };

    await this.callTeamsApi(channel, payload);

    return new Promise<{ approved: boolean; approver?: string; timestamp?: string }>((resolve) => {
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
    });
  }

  async getStatus(): Promise<{ connected: boolean; error?: string }> {
    try {
      const token = await this.getAccessToken();
      if (!token) {
        return { connected: false, error: 'Failed to obtain access token' };
      }
      this._connected = true;
      return { connected: true };
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      return { connected: false, error: msg };
    }
  }

  registerWebhook(url: string): void {
    process.env.ICOPILOT_TEAMS_WEBHOOK_URL = url;
  }

  handleApprovalResponse(id: string, approved: boolean, userId?: string): void {
    const pending = this.pendingApprovals.get(id);
    if (!pending) return;

    clearTimeout(pending.timeout);
    this.pendingApprovals.delete(id);

    pending.resolve({
      approved,
      approver: userId,
      timestamp: new Date().toISOString(),
    });
  }

  private async getAccessToken(): Promise<string> {
    const url = 'https://login.microsoftonline.com/botframework.com/oauth2/v2.0/token';

    const params = new URLSearchParams({
      client_id: this.appId,
      client_secret: this.appPassword,
      grant_type: 'client_credentials',
      scope: 'https://api.botframework.com/.default',
    });

    const response = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: params.toString(),
    });

    if (!response.ok) {
      throw new Error(`Teams auth error: ${response.status}`);
    }

    const data = (await response.json()) as Record<string, unknown>;
    const token = data.access_token as string | undefined;
    if (!token) throw new Error('No access token in response');
    return token;
  }

  private async callTeamsApi(
    channel: string,
    payload: TeamsMessage,
  ): Promise<Record<string, unknown>> {
    const token = await this.getAccessToken();

    const response = await fetch(
      `https://smba.trafficmanager.net/apis/v3/conversations/${channel}/activities`,
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify(payload),
      },
    );

    if (!response.ok) {
      throw new Error(`Teams API error: ${response.status} ${response.statusText}`);
    }

    return (await response.json()) as Record<string, unknown>;
  }
}
