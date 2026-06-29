export interface TeamEvent {
  type: string;
  data: unknown;
}

export interface TeamTransport {
  connect(roomId: string): Promise<void>;
  send(event: TeamEvent): Promise<void>;
  on(handler: (event: TeamEvent) => void): void;
  disconnect(): Promise<void>;
}

export interface NotificationHandler {
  notify(channel: string, message: string, metadata?: Record<string, unknown>): Promise<void>;
  requestApproval(
    channel: string,
    action: string,
    details: { description?: string; timeout?: number },
  ): Promise<{ approved: boolean; approver?: string; timestamp?: string }>;
  getStatus(): Promise<{ connected: boolean; error?: string }>;
}

export interface NotificationFormatter {
  formatText(message: string): Record<string, unknown>;
  formatApprovalRequest(action: string, details: Record<string, unknown>): Record<string, unknown>;
  formatError(error: string): Record<string, unknown>;
}

export const noopTeamTransport: TeamTransport = {
  async connect() {
    throw new Error('Team mode transport not configured. See docs/future.md.');
  },
  async send() {
    /* no-op */
  },
  on() {
    /* no-op */
  },
  async disconnect() {
    /* no-op */
  },
};

const noopNotificationHandler: NotificationHandler = {
  async notify() {
    /* no-op */
  },
  async requestApproval() {
    return { approved: false };
  },
  async getStatus() {
    return { connected: false, error: 'Notifications not configured' };
  },
};

let _transport: TeamTransport = noopTeamTransport;
let _notificationHandler: NotificationHandler = noopNotificationHandler;

export function registerTeamTransport(t: TeamTransport): void {
  _transport = t;
}

export function getTeamTransport(): TeamTransport {
  return _transport;
}

export function registerNotificationHandler(handler: NotificationHandler): void {
  _notificationHandler = handler;
}

export function getNotificationHandler(): NotificationHandler {
  return _notificationHandler;
}

export interface NotificationConfig {
  provider: 'slack' | 'teams';
  token: string;
  channel: string;
  autoApprove?: string[];
}

export function isTeamConfigured(config?: NotificationConfig | null): boolean {
  return config != null && Boolean(config.token && config.channel);
}

export function getTeamConfig(env?: Record<string, string | undefined>): NotificationConfig | null {
  const e = env || process.env;
  const provider = e.ICOPILOT_NOTIFICATIONS_PROVIDER as 'slack' | 'teams' | undefined;
  const token = e.ICOPILOT_NOTIFICATIONS_TOKEN;
  const channel = e.ICOPILOT_NOTIFICATIONS_CHANNEL;

  if (!provider || !token || !channel) return null;

  return {
    provider,
    token,
    channel,
    autoApprove: e.ICOPILOT_NOTIFICATIONS_AUTO_APPROVE?.split(',').filter(Boolean),
  };
}
