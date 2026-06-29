import { describe, it, expect, beforeEach, vi } from 'vitest';
import { NotificationManager, initializeNotificationManager, getNotificationManager } from '../../src/notifications/manager.js';
import type { NotificationConfig } from '../../src/extensions/team.js';
import { SlackNotificationHandler } from '../../src/extensions/slack-provider.js';
import { TeamsNotificationHandler } from '../../src/extensions/teams-provider.js';

describe('NotificationManager', () => {
  describe('initialization', () => {
    it('should initialize with config', () => {
      const config: NotificationConfig = {
        provider: 'slack',
        token: 'xoxb-test-token',
        channel: '#notifications',
      };

      const manager = new NotificationManager(config);
      expect(manager.isConfigured()).toBe(true);
      expect(manager.getConfig()).toEqual(config);
    });

    it('should initialize without config', () => {
      const manager = new NotificationManager(null);
      expect(manager.isConfigured()).toBe(false);
      expect(manager.getConfig()).toBeNull();
    });

    it('should handle invalid config gracefully', () => {
      const config: NotificationConfig = {
        provider: 'slack',
        token: '',
        channel: '',
      };

      const manager = new NotificationManager(config);
      expect(manager.isConfigured()).toBe(false);
    });
  });

  describe('formatOutput', () => {
    beforeEach(() => {
      initializeNotificationManager(null);
    });

    it('should format text output', () => {
      const manager = getNotificationManager();
      const result = manager.formatOutput('Hello World', 'text');
      expect(result).toBe('Hello World');
    });

    it('should format code output', () => {
      const manager = getNotificationManager();
      const result = manager.formatOutput('console.log("test")', 'code');
      expect(result).toContain('```');
      expect(result).toContain('console.log("test")');
    });

    it('should format error output', () => {
      const manager = getNotificationManager();
      const result = manager.formatOutput('Something went wrong', 'error');
      expect(result).toContain('Error');
      expect(result).toContain('Something went wrong');
    });
  });

  describe('slack provider', () => {
    it('should initialize SlackNotificationHandler', () => {
      const handler = new SlackNotificationHandler('xoxb-test', '#test');
      expect(handler).toBeDefined();
    });

    it('should format text for Slack', () => {
      const handler = new SlackNotificationHandler('xoxb-test', '#test');
      const formatted = (handler as any).formatter.formatText('Test message');
      expect(formatted).toHaveProperty('type', 'section');
      expect(formatted).toHaveProperty('text');
    });

    it('should format approval request for Slack', () => {
      const handler = new SlackNotificationHandler('xoxb-test', '#test');
      const details = { id: 'test-123', description: 'Test approval', timeout: 300000 };
      const formatted = (handler as any).formatter.formatApprovalRequest('approve_action', details);
      expect(formatted).toHaveProperty('blocks');
      const blocks = formatted.blocks as unknown[];
      expect(Array.isArray(blocks)).toBe(true);
    });

    it('should format error for Slack', () => {
      const handler = new SlackNotificationHandler('xoxb-test', '#test');
      const formatted = (handler as any).formatter.formatError('Test error');
      expect(formatted).toHaveProperty('type', 'section');
    });
  });

  describe('teams provider', () => {
    it('should initialize TeamsNotificationHandler', () => {
      const handler = new TeamsNotificationHandler('app-id', 'app-password', 'channel-id');
      expect(handler).toBeDefined();
    });

    it('should format text for Teams', () => {
      const handler = new TeamsNotificationHandler('app-id', 'app-password', 'channel-id');
      const formatted = (handler as any).formatter.formatText('Test message');
      expect(formatted).toHaveProperty('type', 'AdaptiveCard');
      expect(formatted).toHaveProperty('body');
    });

    it('should format approval request for Teams', () => {
      const handler = new TeamsNotificationHandler('app-id', 'app-password', 'channel-id');
      const details = {
        id: 'test-123',
        description: 'Test approval',
        timeout: 300000,
        approveUrl: 'http://example.com/approve',
        denyUrl: 'http://example.com/deny',
      };
      const formatted = (handler as any).formatter.formatApprovalRequest('approve_action', details);
      expect(formatted).toHaveProperty('type', 'AdaptiveCard');
      expect(formatted).toHaveProperty('actions');
    });

    it('should format error for Teams', () => {
      const handler = new TeamsNotificationHandler('app-id', 'app-password', 'channel-id');
      const formatted = (handler as any).formatter.formatError('Test error');
      expect(formatted).toHaveProperty('type', 'AdaptiveCard');
    });
  });

  describe('sendNotification', () => {
    it('should not crash when handler is not configured', async () => {
      const manager = new NotificationManager(null);
      await expect(manager.sendNotification('test message')).resolves.not.toThrow();
    });

    it('should pass message to handler when configured', async () => {
      const config: NotificationConfig = {
        provider: 'slack',
        token: 'xoxb-test',
        channel: '#test',
      };

      const manager = new NotificationManager(config);
      const mockHandler = {
        notify: vi.fn().mockResolvedValue(undefined),
        requestApproval: vi.fn(),
        getStatus: vi.fn(),
      };

      const notifyMethod = manager.sendNotification('test message', { channel: '#test' });
      await expect(notifyMethod).resolves.not.toThrow();
    });
  });

  describe('requestUserApproval', () => {
    it('should return false when handler not configured', async () => {
      const manager = new NotificationManager(null);
      const result = await manager.requestUserApproval('test_action', { timeout: 5000 });
      expect(result.approved).toBe(false);
    });

    it('should pass approval request to handler', async () => {
      const config: NotificationConfig = {
        provider: 'slack',
        token: 'xoxb-test',
        channel: '#test',
      };

      const manager = new NotificationManager(config);
      const result = await manager.requestUserApproval('test_action', {
        description: 'Test approval request',
        timeout: 1000,
      });

      expect(result).toHaveProperty('approved');
      expect(typeof result.approved).toBe('boolean');
    });
  });

  describe('getStatus', () => {
    it('should return disconnected when not configured', async () => {
      const manager = new NotificationManager(null);
      const status = await manager.getStatus();
      expect(status.connected).toBe(false);
    });
  });

  describe('global manager', () => {
    it('should return same instance on multiple calls', () => {
      initializeNotificationManager(null);
      const manager1 = getNotificationManager();
      const manager2 = getNotificationManager();
      expect(manager1).toBe(manager2);
    });

    it('should reinitialize with new config', () => {
      const config: NotificationConfig = {
        provider: 'slack',
        token: 'xoxb-test',
        channel: '#test',
      };

      initializeNotificationManager(config);
      const manager = getNotificationManager();
      expect(manager.isConfigured()).toBe(true);
    });
  });
});
