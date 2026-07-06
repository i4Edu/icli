import fs from 'node:fs';
import path from 'node:path';
import { config } from '../config.js';
import { theme } from '../ui/theme.js';

export interface TicketConfig {
  provider: 'jira' | 'linear' | 'github';
  baseUrl?: string;
  apiToken?: string;
  projectKey?: string;
}

export interface Ticket {
  id: string;
  title: string;
  status: string;
  assignee?: string;
  labels?: string[];
  url: string;
  linkedSessionId?: string;
}

export interface TicketUpdate {
  ticketId: string;
  status?: string;
  comment?: string;
  sessionId?: string;
}

interface TicketApiResponse {
  tickets?: unknown;
  issues?: unknown;
  items?: unknown;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function isStringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((item) => typeof item === 'string');
}

function cloneTicket(ticket: Ticket): Ticket {
  return {
    ...ticket,
    labels: ticket.labels ? [...ticket.labels] : undefined,
  };
}

function normalizeBaseUrl(baseUrl?: string): string | undefined {
  if (typeof baseUrl !== 'string' || !baseUrl.trim()) return undefined;
  return baseUrl.replace(/\/+$/, '');
}

function buildTicketUrl(ticketId: string, ticketConfig: TicketConfig | null): string {
  const baseUrl = normalizeBaseUrl(ticketConfig?.baseUrl);
  if (!baseUrl) return ticketId;
  switch (ticketConfig?.provider) {
    case 'jira':
      return `${baseUrl}/browse/${ticketId}`;
    case 'linear':
      return `${baseUrl}/issue/${ticketId}`;
    case 'github':
      return `${baseUrl}/issues/${ticketId}`;
    default:
      return `${baseUrl}/${ticketId}`;
  }
}

function normalizeTicket(value: unknown, ticketConfig: TicketConfig | null): Ticket | null {
  if (!isRecord(value)) return null;
  const id =
    typeof value.id === 'string' ? value.id : typeof value.key === 'string' ? value.key : null;
  const title =
    typeof value.title === 'string'
      ? value.title
      : typeof value.summary === 'string'
        ? value.summary
        : null;
  const status =
    typeof value.status === 'string'
      ? value.status
      : isRecord(value.status) && typeof value.status.name === 'string'
        ? value.status.name
        : null;
  if (!id || !title || !status) return null;
  return {
    id,
    title,
    status,
    assignee: typeof value.assignee === 'string' ? value.assignee : undefined,
    labels: isStringArray(value.labels) ? [...value.labels] : undefined,
    url: typeof value.url === 'string' ? value.url : buildTicketUrl(id, ticketConfig),
    linkedSessionId: typeof value.linkedSessionId === 'string' ? value.linkedSessionId : undefined,
  };
}

function extractTickets(payload: unknown, ticketConfig: TicketConfig | null): Ticket[] {
  const candidates = isRecord(payload)
    ? [payload.tickets, payload.issues, payload.items]
    : [payload];
  for (const candidate of candidates) {
    if (!Array.isArray(candidate)) continue;
    return candidate
      .map((item) => normalizeTicket(item, ticketConfig))
      .filter((ticket): ticket is Ticket => ticket !== null);
  }
  return [];
}

function configPath(cwd: string): string {
  return path.join(cwd, '.icopilot', 'ticket-tracker.json');
}

function isTicketConfig(value: unknown): value is TicketConfig {
  return (
    isRecord(value) &&
    (value.provider === 'jira' || value.provider === 'linear' || value.provider === 'github')
  );
}

export class TicketTracker {
  private ticketConfig: TicketConfig | null = null;
  private readonly tickets = new Map<string, Ticket>();

  configure(nextConfig: TicketConfig): void {
    this.ticketConfig = { ...nextConfig };
  }

  linkSession(ticketId: string, sessionId: string): Ticket {
    const ticket = this.ensureTicket(ticketId);
    ticket.linkedSessionId = sessionId;
    return cloneTicket(ticket);
  }

  updateStatus(update: TicketUpdate): Ticket {
    const ticket = this.ensureTicket(update.ticketId);
    if (update.status) ticket.status = update.status;
    if (update.sessionId) ticket.linkedSessionId = update.sessionId;
    if (update.comment && !ticket.title.startsWith(update.comment)) {
      ticket.title = ticket.title === ticket.id ? `${update.comment} (${ticket.id})` : ticket.title;
    }
    return cloneTicket(ticket);
  }

  getLinkedTickets(sessionId?: string): Ticket[] {
    return [...this.tickets.values()]
      .filter((ticket) =>
        sessionId ? ticket.linkedSessionId === sessionId : Boolean(ticket.linkedSessionId),
      )
      .map((ticket) => cloneTicket(ticket));
  }

  async syncStatus(): Promise<Ticket[]> {
    if (!this.ticketConfig || this.tickets.size === 0 || typeof fetch !== 'function') {
      return this.snapshot();
    }
    const baseUrl = normalizeBaseUrl(this.ticketConfig.baseUrl);
    if (!baseUrl) return this.snapshot();

    const ids = [...this.tickets.keys()];
    try {
      const response = await fetch(
        `${baseUrl}/tickets?provider=${encodeURIComponent(this.ticketConfig.provider)}&ids=${encodeURIComponent(ids.join(','))}`,
        {
          headers: this.ticketConfig.apiToken
            ? { Authorization: 'Bearer '.concat(this.ticketConfig.apiToken) }
            : undefined,
        },
      );
      if (!response.ok) return this.snapshot();
      const payload = (await response.json()) as TicketApiResponse;
      const syncedTickets = extractTickets(payload, this.ticketConfig);
      for (const syncedTicket of syncedTickets) {
        const current = this.tickets.get(syncedTicket.id);
        this.tickets.set(syncedTicket.id, {
          ...syncedTicket,
          linkedSessionId: current?.linkedSessionId,
        });
      }
    } catch {
      return this.snapshot();
    }

    return this.snapshot();
  }

  formatTicket(ticket: Ticket): string {
    const status = theme.badge(ticket.status.toUpperCase());
    const assignee = ticket.assignee ? ' '.concat(theme.dim('@'.concat(ticket.assignee))) : '';
    const labels = ticket.labels?.length
      ? ' '.concat(theme.hint('['.concat(ticket.labels.join(', '), ']')))
      : '';
    const linked = ticket.linkedSessionId
      ? ' '.concat(theme.dim('session:'.concat(ticket.linkedSessionId)))
      : '';
    return [
      status,
      theme.hl(ticket.id),
      ''.concat(ticket.title, assignee, labels, linked),
      theme.dim(ticket.url),
    ].join(' ');
  }

  private ensureTicket(ticketId: string): Ticket {
    const existing = this.tickets.get(ticketId);
    if (existing) return existing;
    const created: Ticket = {
      id: ticketId,
      title: ticketId,
      status: 'linked',
      url: buildTicketUrl(ticketId, this.ticketConfig),
    };
    this.tickets.set(ticketId, created);
    return created;
  }

  private snapshot(): Ticket[] {
    return [...this.tickets.values()].map((ticket) => cloneTicket(ticket));
  }
}

export function loadTicketConfig(cwd = config.cwd): TicketConfig | null {
  const filePath = configPath(cwd);
  try {
    if (!fs.existsSync(filePath)) return null;
    const parsed = JSON.parse(fs.readFileSync(filePath, 'utf8')) as unknown;
    if (!isTicketConfig(parsed)) return null;
    return {
      provider: parsed.provider,
      baseUrl: typeof parsed.baseUrl === 'string' ? parsed.baseUrl : undefined,
      apiToken: typeof parsed.apiToken === 'string' ? parsed.apiToken : undefined,
      projectKey: typeof parsed.projectKey === 'string' ? parsed.projectKey : undefined,
    };
  } catch {
    return null;
  }
}

export function formatTicketList(tickets: Ticket[]): string {
  if (!tickets.length) return theme.hint('No linked tickets configured.');
  const tracker = new TicketTracker();
  return tickets.map((ticket) => tracker.formatTicket(ticket)).join('\n');
}
