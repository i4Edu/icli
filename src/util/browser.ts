import { spawn, type ChildProcess } from 'node:child_process';

type SpawnLike = typeof spawn;

export async function openBrowser(url: string, spawnImpl: SpawnLike = spawn): Promise<void> {
  const platform = process.platform;
  const { command, args } = resolveBrowserCommand(platform, url);

  await new Promise<void>((resolve, reject) => {
    const child = spawnImpl(command, args, {
      detached: true,
      stdio: 'ignore',
      windowsHide: true,
    });
    const proc = child as ChildProcess & { unref?: () => void };
    proc.once('error', reject);
    proc.unref?.();
    resolve();
  });
}

export function resolveBrowserCommand(
  platform: NodeJS.Platform,
  url: string,
): { command: string; args: string[] } {
  if (platform === 'win32') {
    return {
      command: 'cmd',
      args: ['/c', 'start', '', url],
    };
  }
  if (platform === 'darwin') {
    return {
      command: 'open',
      args: [url],
    };
  }
  return {
    command: 'xdg-open',
    args: [url],
  };
}
