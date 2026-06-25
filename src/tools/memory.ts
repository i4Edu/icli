export class ToolMemory {
  readonly allowShell = new Set<string>();
  readonly allowWritePath = new Set<string>();

  rememberShell(cmd: string): void {
    this.allowShell.add(cmd);
  }

  isShellRemembered(cmd: string): boolean {
    return this.allowShell.has(cmd);
  }

  rememberWrite(absPath: string): void {
    this.allowWritePath.add(absPath);
  }

  isWriteRemembered(absPath: string): boolean {
    return this.allowWritePath.has(absPath);
  }
}

export const toolMemory = new ToolMemory();
