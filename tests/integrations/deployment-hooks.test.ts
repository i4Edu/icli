import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  DeploymentHookManager,
  formatDeploymentEvent,
  loadDeploymentHooks,
} from '../../src/integrations/deployment-hooks.js';

describe('DeploymentHookManager', () => {
  it('runs matching hooks and preserves attached session context', async () => {
    const manager = new DeploymentHookManager();
    manager.attachToSession('session-1', {
      environment: 'production',
      version: '2.5.0',
      commitSha: 'abc123',
      branch: 'main',
      timestamp: 1,
    });
    manager.registerHook({
      name: 'annotate',
      trigger: 'post-deploy',
      action: (event) => ({ message: `deployed ${event.context.version}` }),
    });
    manager.registerHook({
      name: 'notify',
      trigger: 'post-deploy',
      action: 'notify-release-channel',
    });

    const result = await manager.triggerHooks({
      type: 'post-deploy',
      sessionId: 'session-1',
      context: {
        environment: 'staging',
        version: 'ignored',
        commitSha: 'ignored',
        branch: 'ignored',
        timestamp: 2,
      },
    });

    expect(result.context.environment).toBe('production');
    expect(result.hookResults).toEqual([
      expect.objectContaining({ name: 'annotate', success: true }),
      expect.objectContaining({
        name: 'notify',
        success: true,
        output: 'executed notify-release-channel',
      }),
    ]);
  });

  it('removes hooks and formats results', async () => {
    const manager = new DeploymentHookManager();
    manager.registerHook({
      name: 'rollback-check',
      trigger: 'rollback',
      action: () => 'rollback ready',
    });
    expect(manager.removeHook('missing')).toBe(false);
    expect(manager.getHooks()).toHaveLength(1);

    const event = await manager.triggerHooks({
      type: 'rollback',
      context: {
        environment: 'prod',
        version: '2.5.1',
        commitSha: 'def456',
        branch: 'release',
        timestamp: 3,
      },
    });

    expect(formatDeploymentEvent(event)).toContain('rollback ready');
  });

  it('loads hook definitions from disk', () => {
    const root = path.join(process.cwd(), '.vitest-deployment-hooks');
    fs.mkdirSync(path.join(root, '.icopilot'), { recursive: true });
    fs.writeFileSync(
      path.join(root, '.icopilot', 'deployment-hooks.json'),
      JSON.stringify([{ name: 'approve', trigger: 'pre-deploy', action: 'check-change-window' }]),
      'utf8',
    );

    expect(loadDeploymentHooks(root)).toEqual([
      { name: 'approve', trigger: 'pre-deploy', action: 'check-change-window' },
    ]);
    fs.rmSync(root, { recursive: true, force: true });
  });
});
