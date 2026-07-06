import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import {
  RemoteExecutor,
  formatExecutionResult,
  loadExecutionTargets,
} from '../../src/integrations/remote-execution.js';

describe('RemoteExecutor', () => {
  it('executes commands through the injected runner', async () => {
    const runner = vi.fn(async () => ({ exitCode: 0, stdout: 'ok', stderr: '' }));
    const executor = new RemoteExecutor({ runner });
    executor.addTarget({ id: 'ssh-prod', name: 'Prod', type: 'ssh', host: 'prod.example.com' });

    const result = await executor.execute({
      target: 'ssh-prod',
      command: 'uptime',
      env: { CI: '1' },
    });

    expect(runner).toHaveBeenCalledWith(
      expect.objectContaining({
        command: 'uptime',
        targetConfig: expect.objectContaining({ id: 'ssh-prod' }),
      }),
    );
    expect(result).toEqual(
      expect.objectContaining({ exitCode: 0, stdout: 'ok', targetId: 'ssh-prod' }),
    );
    expect(executor.getStatus('ssh-prod')).toEqual(
      expect.objectContaining({ connected: true, running: false, lastResult: result }),
    );
  });

  it('tests connections and formats execution results', async () => {
    const runner = vi.fn(async ({ command }: { command: string }) => ({
      exitCode: command === 'printf connected' ? 0 : 1,
      stdout: 'connected',
      stderr: '',
    }));
    const executor = new RemoteExecutor({ runner: runner as never });
    executor.addTarget({ id: 'container-ci', name: 'CI', type: 'container' });

    expect(await executor.testConnection('container-ci')).toBe(true);
    expect(
      formatExecutionResult({
        targetId: 'container-ci',
        command: 'echo ok',
        exitCode: 0,
        stdout: 'ok',
        stderr: '',
        durationMs: 12,
      }),
    ).toContain('ok');
  });

  it('loads execution targets from disk', () => {
    const root = path.join(process.cwd(), '.vitest-execution-targets');
    fs.mkdirSync(path.join(root, '.icopilot'), { recursive: true });
    fs.writeFileSync(
      path.join(root, '.icopilot', 'execution-targets.json'),
      JSON.stringify([{ id: 'cloud', name: 'Cloud', type: 'cloud', host: 'api.example.com' }]),
      'utf8',
    );

    expect(loadExecutionTargets(root)).toEqual([
      { id: 'cloud', name: 'Cloud', type: 'cloud', host: 'api.example.com', config: undefined },
    ]);
    fs.rmSync(root, { recursive: true, force: true });
  });
});
