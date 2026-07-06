import fs from 'node:fs';
import path from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  TicketTracker,
  formatTicketList,
  loadTicketConfig,
} from '../../src/integrations/ticket-tracker.js';

const fetchMock = vi.fn<typeof fetch>();
vi.stubGlobal('fetch', fetchMock);

describe('TicketTracker', () => {
  afterEach(() => {
    fetchMock.mockReset();
  });

  it('links sessions and updates ticket state', () => {
    const tracker = new TicketTracker();
    tracker.configure({ provider: 'jira', baseUrl: 'https://jira.example.com' });

    const linked = tracker.linkSession('ENG-123', 'session-1');
    const updated = tracker.updateStatus({ ticketId: 'ENG-123', status: 'in-progress' });

    expect(linked.url).toBe('https://jira.example.com/browse/ENG-123');
    expect(updated.status).toBe('in-progress');
    expect(tracker.getLinkedTickets('session-1')).toEqual([
      expect.objectContaining({
        id: 'ENG-123',
        linkedSessionId: 'session-1',
        status: 'in-progress',
      }),
    ]);
  });

  it('syncs ticket data from a remote payload', async () => {
    fetchMock.mockResolvedValue({
      ok: true,
      json: async () => ({
        tickets: [
          {
            id: 'ENG-321',
            title: 'Fix flaky deployment',
            status: 'done',
            assignee: 'casey',
            labels: ['release'],
            url: 'https://linear.example.com/issue/ENG-321',
          },
        ],
      }),
    } as Response);

    const tracker = new TicketTracker();
    tracker.configure({
      provider: 'linear',
      baseUrl: 'https://linear.example.com',
      apiToken: 'secret',
    });
    tracker.linkSession('ENG-321', 'session-2');

    const synced = await tracker.syncStatus();

    expect(fetchMock).toHaveBeenCalledOnce();
    expect(synced).toEqual([
      expect.objectContaining({
        id: 'ENG-321',
        status: 'done',
        linkedSessionId: 'session-2',
        assignee: 'casey',
      }),
    ]);
  });

  it('loads config files and formats ticket lists', () => {
    const root = path.join(process.cwd(), '.vitest-ticket-tracker');
    fs.mkdirSync(path.join(root, '.icopilot'), { recursive: true });
    fs.writeFileSync(
      path.join(root, '.icopilot', 'ticket-tracker.json'),
      JSON.stringify({ provider: 'github', baseUrl: 'https://github.com/org/repo' }),
      'utf8',
    );

    const loaded = loadTicketConfig(root);
    const formatted = formatTicketList([
      {
        id: '42',
        title: 'Ship feature',
        status: 'open',
        url: 'https://github.com/org/repo/issues/42',
      },
    ]);

    expect(loaded).toEqual({
      provider: 'github',
      baseUrl: 'https://github.com/org/repo',
      apiToken: undefined,
      projectKey: undefined,
    });
    expect(formatted).toContain('Ship feature');
    fs.rmSync(root, { recursive: true, force: true });
  });
});
