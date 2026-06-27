import path from 'node:path';
import { exec } from 'node:child_process';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ContainerSandbox } from '../../src/sandbox/container.js';

vi.mock('node:child_process', () => ({ exec: vi.fn() }));

const execMock = vi.mocked(exec);

type ExecCallback = (error: Error | null, stdout: string, stderr: string) => void;

function mockExecImplementation(handler: (command: string, callback: ExecCallback) => void): void {
  execMock.mockImplementation(((command: string, options: unknown, callback: unknown) => {
    const actualCallback = (typeof options === 'function' ? options : callback) as ExecCallback;
    handler(command, actualCallback);
    return {} as never;
  }) as typeof exec);
}

describe('ContainerSandbox', () => {
  let sandbox: ContainerSandbox;

  beforeEach(() => {
    sandbox = new ContainerSandbox(path.resolve('E:/AI/icli'));
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it('reports default image', () => {
    expect(sandbox.getDefaultImage()).toBe('node:20-alpine');
  });

  it('creates containers with a readonly project mount and resource flags', async () => {
    mockExecImplementation((command, callback) => {
      expect(command).toContain('docker');
      expect(command).toContain('run');
      expect(command).toContain('node:20-alpine');
      expect(command).toContain('/workspace:ro');
      expect(command).toContain('--memory');
      expect(command).toContain('512m');
      expect(command).toContain('--cpus');
      expect(command).toContain('1.5');
      callback(null, 'abc123\n', '');
    });

    await expect(
      sandbox.create({ image: sandbox.getDefaultImage(), memory: '512m', cpus: 1.5 }),
    ).resolves.toBe('abc123');
  });

  it('executes commands inside a known container', async () => {
    let callCount = 0;
    mockExecImplementation((command, callback) => {
      callCount += 1;
      if (callCount === 1) {
        callback(null, 'abc123\n', '');
        return;
      }
      expect(command).toContain('docker');
      expect(command).toContain('exec');
      expect(command).toContain('abc123');
      expect(command).toContain('npm test');
      callback(null, 'ok\n', 'warn\n');
    });

    const containerId = await sandbox.create({ image: sandbox.getDefaultImage() });
    await expect(sandbox.exec(containerId, 'npm test')).resolves.toEqual({
      stdout: 'ok\n',
      stderr: 'warn\n',
      code: 0,
    });
  });

  it('destroys containers', async () => {
    mockExecImplementation((command, callback) => {
      expect(command).toContain('docker');
      expect(command).toContain('rm');
      expect(command).toContain('-f');
      expect(command).toContain('abc123');
      callback(null, '', '');
    });

    await expect(sandbox.destroy('abc123')).resolves.toBeUndefined();
  });

  it('detects docker availability', async () => {
    mockExecImplementation((_command, callback) => {
      callback(null, '27.0.1\n', '');
    });

    await expect(sandbox.isDockerAvailable()).resolves.toBe(true);
  });

  it('returns false when docker is unavailable', async () => {
    mockExecImplementation((_command, callback) => {
      callback(Object.assign(new Error('missing docker'), { code: 1 }), '', 'missing docker');
    });

    await expect(sandbox.isDockerAvailable()).resolves.toBe(false);
  });

  it('lists running sandbox containers', async () => {
    mockExecImplementation((_command, callback) => {
      callback(null, 'abc123\tnode:20-alpine\tUp 5 seconds\ticopilot-sandbox\n', '');
    });

    await expect(sandbox.listRunning()).resolves.toEqual([
      {
        id: 'abc123',
        image: 'node:20-alpine',
        status: 'Up 5 seconds',
        name: 'icopilot-sandbox',
      },
    ]);
  });
});
