import path from 'node:path';
import { exec } from 'node:child_process';

export interface ContainerMount {
  source: string;
  target: string;
  readonly?: boolean;
}

export interface ContainerConfig {
  image: string;
  workDir?: string;
  mounts?: ContainerMount[];
  env?: Record<string, string>;
  timeout?: number;
  memory?: string;
  cpus?: number;
}

export interface ContainerExecResult {
  stdout: string;
  stderr: string;
  code: number;
}

export interface RunningContainer {
  id: string;
  image: string;
  status: string;
  name: string;
}

interface ExecOutcome {
  stdout: string;
  stderr: string;
  code: number;
}

const DEFAULT_IMAGE = process.env.ICOPILOT_SANDBOX_IMAGE?.trim() || 'node:20-alpine';
const DEFAULT_TIMEOUT_MS = 30_000;
const DEFAULT_WORKDIR = '/workspace';
const SANDBOX_LABEL = 'icopilot.sandbox=1';
const MAX_BUFFER = 10 * 1024 * 1024;

export class ContainerSandbox {
  private readonly projectRoot: string;
  private readonly containers = new Map<string, ContainerConfig>();

  constructor(projectRoot = process.cwd()) {
    this.projectRoot = path.resolve(projectRoot);
  }

  getDefaultImage(): string {
    return DEFAULT_IMAGE;
  }

  async isDockerAvailable(): Promise<boolean> {
    try {
      const result = await this.runDocker(['docker', 'version', '--format', '{{.Server.Version}}']);
      return result.code === 0 && result.stdout.trim().length > 0;
    } catch {
      return false;
    }
  }

  async create(config: ContainerConfig): Promise<string> {
    const normalized = this.normalizeConfig(config);
    const args = [
      'docker',
      'run',
      '-d',
      '--rm',
      '--init',
      '--label',
      SANDBOX_LABEL,
      '--workdir',
      normalized.workDir,
    ];

    for (const mount of normalized.mounts) {
      const mode = mount.readonly ? 'ro' : 'rw';
      args.push('-v', `${path.resolve(mount.source)}:${mount.target}:${mode}`);
    }

    for (const [key, value] of Object.entries(normalized.env)) {
      args.push('-e', `${key}=${value}`);
    }

    if (normalized.memory) {
      args.push('--memory', normalized.memory);
    }

    if (
      typeof normalized.cpus === 'number' &&
      Number.isFinite(normalized.cpus) &&
      normalized.cpus > 0
    ) {
      args.push('--cpus', String(normalized.cpus));
    }

    args.push(normalized.image, 'sh', '-lc', 'trap exit TERM INT; while :; do sleep 1000; done');

    const result = await this.runDocker(args, normalized.timeout);
    const containerId = result.stdout.trim();
    if (!containerId) {
      throw new Error(result.stderr.trim() || 'docker did not return a container id');
    }

    this.containers.set(containerId, normalized);
    return containerId;
  }

  async exec(containerId: string, command: string): Promise<ContainerExecResult> {
    const normalizedId = containerId.trim();
    if (!normalizedId) {
      throw new Error('container id is required');
    }

    const knownConfig = this.containers.get(normalizedId);
    return this.runDocker(
      ['docker', 'exec', normalizedId, 'sh', '-lc', command],
      knownConfig?.timeout,
    );
  }

  async destroy(containerId: string): Promise<void> {
    const normalizedId = containerId.trim();
    if (!normalizedId) {
      return;
    }

    try {
      await this.runDocker(['docker', 'rm', '-f', normalizedId]);
    } finally {
      this.containers.delete(normalizedId);
    }
  }

  async listRunning(): Promise<RunningContainer[]> {
    const result = await this.runDocker([
      'docker',
      'ps',
      '--filter',
      `label=${SANDBOX_LABEL}`,
      '--format',
      '{{.ID}}\t{{.Image}}\t{{.Status}}\t{{.Names}}',
    ]);

    return result.stdout
      .split(/\r?\n/u)
      .map((line) => line.trim())
      .filter(Boolean)
      .map((line) => {
        const [id = '', image = '', status = '', name = ''] = line.split('\t');
        return { id, image, status, name };
      });
  }

  private normalizeConfig(config: ContainerConfig): NormalizedContainerConfig {
    const workDir = config.workDir?.trim() || DEFAULT_WORKDIR;
    const mounts = [...(config.mounts || [])];
    const hasProjectMount = mounts.some(
      (mount) => path.resolve(mount.source) === this.projectRoot || mount.target === workDir,
    );

    if (!hasProjectMount) {
      mounts.unshift({
        source: this.projectRoot,
        target: workDir,
        readonly: true,
      });
    }

    return {
      ...config,
      image: config.image?.trim() || this.getDefaultImage(),
      workDir,
      mounts,
      env: { ...(config.env || {}) },
      timeout: config.timeout ?? DEFAULT_TIMEOUT_MS,
    };
  }

  private async runDocker(args: string[], timeout = DEFAULT_TIMEOUT_MS): Promise<ExecOutcome> {
    const command = args.map((arg) => quoteForShell(arg)).join(' ');

    return new Promise<ExecOutcome>((resolve, reject) => {
      exec(
        command,
        {
          timeout,
          maxBuffer: MAX_BUFFER,
          shell: process.platform === 'win32' ? 'powershell.exe' : '/bin/sh',
        },
        (error, stdout, stderr) => {
          const code =
            typeof (error as NodeJS.ErrnoException | null)?.code === 'number'
              ? Number((error as NodeJS.ErrnoException).code)
              : 0;
          const outcome = { stdout, stderr, code };
          if (error && code === 0) {
            reject(error);
            return;
          }
          if (error) {
            reject(Object.assign(new Error(stderr.trim() || error.message), outcome));
            return;
          }
          resolve(outcome);
        },
      );
    });
  }
}

interface NormalizedContainerConfig extends ContainerConfig {
  workDir: string;
  mounts: ContainerMount[];
  env: Record<string, string>;
  timeout: number;
}

function quoteForShell(value: string): string {
  if (process.platform === 'win32') {
    return `'${value.replace(/'/g, "''")}'`;
  }
  return `'${value.replace(/'/g, `'\\''`)}'`;
}
