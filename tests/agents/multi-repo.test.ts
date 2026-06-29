import fs from 'node:fs';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { MultiRepoOrchestrator } from '../../src/agents/multi-repo.js';
import { defaultContext } from '../../src/util/completion.js';

let tmpRoot: string;
let workspaceDir: string;
let repoOneDir: string;
let repoTwoDir: string;

describe('MultiRepoOrchestrator', { timeout: 30_000 }, () => {
  beforeEach(() => {
    tmpRoot = path.join(process.cwd(), '.vitest-multi-repo-tmp');
    fs.mkdirSync(tmpRoot, { recursive: true });
    workspaceDir = fs.mkdtempSync(path.join(tmpRoot, 'workspace-'));
    repoOneDir = path.join(workspaceDir, 'repo-one');
    repoTwoDir = path.join(workspaceDir, 'repo-two');
    fs.mkdirSync(repoOneDir, { recursive: true });
    fs.mkdirSync(repoTwoDir, { recursive: true });
    fs.writeFileSync(path.join(repoOneDir, 'README.md'), '# Repo One\nshared token\n', 'utf8');
    fs.writeFileSync(
      path.join(repoOneDir, 'src.ts'),
      'export const primaryToken = "shared token";\n',
      'utf8',
    );
    fs.writeFileSync(
      path.join(repoTwoDir, 'index.ts'),
      'export const helper = "shared token";\n',
      'utf8',
    );
  });

  afterEach(() => {
    delete process.env.ICOPILOT_MULTI_REPO_ROOT;
    fs.rmSync(tmpRoot, { recursive: true, force: true });
  });

  it('adds, persists, removes, and switches repositories', () => {
    const orchestrator = new MultiRepoOrchestrator();

    expect(orchestrator.loadConfig(workspaceDir)).toEqual([]);

    const first = orchestrator.addRepo({
      name: 'repo-one',
      path: repoOneDir,
      remote: 'origin',
      branch: 'main',
      role: 'primary',
    });
    const second = orchestrator.addRepo({
      name: 'repo-two',
      path: repoTwoDir,
      branch: 'main',
      role: 'peer',
    });

    expect(first.path).toBe(repoOneDir);
    expect(orchestrator.listRepos().map((repo) => repo.name)).toEqual(['repo-one', 'repo-two']);
    expect(fs.existsSync(path.join(workspaceDir, '.icopilot', 'repos.yaml'))).toBe(true);

    const switched = orchestrator.switchRepo('repo-two');
    expect(switched).toEqual(second);

    const reloaded = new MultiRepoOrchestrator();
    reloaded.loadConfig(workspaceDir);
    expect(reloaded.getCurrentRepoName()).toBe('repo-two');
    expect(reloaded.listRepos()).toEqual([
      expect.objectContaining({ name: 'repo-one', path: repoOneDir }),
      expect.objectContaining({ name: 'repo-two', path: repoTwoDir }),
    ]);

    expect(reloaded.removeRepo('repo-one')).toBe(true);
    expect(reloaded.listRepos().map((repo) => repo.name)).toEqual(['repo-two']);
  });

  it('searches and reports status across repositories', async () => {
    const orchestrator = new MultiRepoOrchestrator();
    orchestrator.loadConfig(workspaceDir);
    orchestrator.addRepo({ name: 'repo-one', path: repoOneDir, role: 'primary', branch: 'main' });
    orchestrator.addRepo({ name: 'repo-two', path: repoTwoDir, role: 'peer', branch: 'main' });

    const hits = await orchestrator.searchAcrossRepos('shared token');
    expect(hits).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ repo: 'repo-one', file: 'README.md' }),
        expect.objectContaining({ repo: 'repo-two', file: 'index.ts' }),
      ]),
    );

    const status = await orchestrator.getStatus();
    expect(status.current).toBe('repo-one');
    expect(status.repos).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          name: 'repo-one',
          exists: true,
        }),
        expect.objectContaining({
          name: 'repo-two',
          exists: true,
        }),
      ]),
    );
  });

  it('wires slash help and completion for /repo', () => {
    const slashSource = fs.readFileSync(
      path.join(process.cwd(), 'src', 'commands', 'slash.ts'),
      'utf8',
    );

    expect(slashSource).toContain("import { repoCommand } from './repo-cmd.js';");
    expect(slashSource).toContain('/repo                       manage multi-repo orchestration');
    expect(slashSource).toContain("case 'repo':");
    expect(slashSource).toContain('await repoCommand(rest, {');
    expect(defaultContext().slashCommands).toContain('repo');
  });
});
