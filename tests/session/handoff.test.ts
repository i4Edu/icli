import fs from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ChatCompletionMessageParam } from 'openai/resources/chat/completions';

let workDir: string;
let sessionDir: string;
let configRef: typeof import('../../src/config.js').config;
let SessionCtor: typeof import('../../src/session/session.js').Session;
let PersistentMemoryCtor: typeof import('../../src/context/persistent-memory.js').PersistentMemory;
let handoffModule: typeof import('../../src/session/handoff.js');
let stdoutSpy: ReturnType<typeof vi.spyOn>;
let output = '';
let originalUserProfile: string | undefined;
let originalHome: string | undefined;

beforeEach(async () => {
  const root = path.join(process.cwd(), '.test-handoff-work');
  fs.mkdirSync(root, { recursive: true });
  workDir = path.join(root, randomUUID());
  sessionDir = path.join(workDir, 'sessions');
  fs.mkdirSync(sessionDir, { recursive: true });

  originalUserProfile = process.env.USERPROFILE;
  originalHome = process.env.HOME;
  process.env.USERPROFILE = workDir;
  process.env.HOME = workDir;
  process.env.ICOPILOT_SESSION_DIR = sessionDir;

  output = '';
  stdoutSpy = vi.spyOn(process.stdout, 'write').mockImplementation((chunk: string | Uint8Array) => {
    output += String(chunk);
    return true;
  });

  vi.resetModules();
  const configModule = await import('../../src/config.js');
  const sessionModule = await import('../../src/session/session.js');
  const persistentMemoryModule = await import('../../src/context/persistent-memory.js');
  handoffModule = await import('../../src/session/handoff.js');

  configRef = configModule.config;
  configRef.cwd = workDir;
  configRef.sessionDir = sessionDir;
  SessionCtor = sessionModule.Session;
  PersistentMemoryCtor = persistentMemoryModule.PersistentMemory;
}, 90_000);

afterEach(() => {
  stdoutSpy.mockRestore();
  if (originalUserProfile === undefined) delete process.env.USERPROFILE;
  else process.env.USERPROFILE = originalUserProfile;
  if (originalHome === undefined) delete process.env.HOME;
  else process.env.HOME = originalHome;
  delete process.env.ICOPILOT_SESSION_DIR;
  fs.rmSync(workDir, { recursive: true, force: true });
  vi.clearAllMocks();
});

describe('session handoff', () => {
  function createSession() {
    const pinnedPath = path.join(workDir, 'pinned.ts');
    fs.writeFileSync(
      pinnedPath,
      "export const pinnedValue = 'handoff';\nexport function pinned() { return pinnedValue; }\n",
      'utf8',
    );

    const session = new SessionCtor({
      id: 'handoff-source',
      createdAt: '2024-01-01T00:00:00.000Z',
      model: 'gpt-test',
      cwd: workDir,
      mode: 'plan',
      systemPrompt: 'Be helpful.',
    });

    session.setTodos([
      {
        id: 'todo-1',
        text: 'Prepare handoff bundle',
        done: false,
        createdAt: '2024-01-01T00:00:00.000Z',
      },
    ]);
    session.setPinned([
      {
        path: pinnedPath,
        addedAt: '2024-01-01T00:00:05.000Z',
        tokens: 18,
      },
    ]);

    const messages: ChatCompletionMessageParam[] = [
      { role: 'user', content: 'Investigate the failing test.' },
      { role: 'assistant', content: 'I found the issue in the session loader.' },
      {
        role: 'tool',
        tool_call_id: 'call_1',
        content: 'loader.ts line 12 throws when the file is missing',
      } as ChatCompletionMessageParam,
    ];
    for (const message of messages) session.push(message);

    const memory = new PersistentMemoryCtor();
    const projectId = memory.getProjectId(workDir);
    memory.remember('owner', 'platform-team', 'user');
    memory.remember('recent-fix', 'session-loader null guard', 'auto');
    memory.save(projectId);

    return session;
  }

  it('creates handoff bundles with limited history, pinned snapshots, and memory', () => {
    const session = createSession();

    const bundle = handoffModule.createHandoff(session, {
      author: 'alice',
      description: 'Continue the session loader fix.',
      maxMessages: 2,
    });

    expect(bundle.version).toBe(1);
    expect(bundle.session.messages).toHaveLength(2);
    expect(bundle.context.pinned[0]?.path).toContain('pinned.ts');
    expect(bundle.context.files[0]?.content).toContain("export const pinnedValue = 'handoff'");
    expect(bundle.context.memory.map((entry) => entry.key)).toEqual(['owner', 'recent-fix']);
    expect(bundle.metadata.author).toBe('alice');
    expect(bundle.metadata.description).toContain('session loader fix');
  });

  it('exports, previews, imports, and restores handoff bundles', () => {
    const session = createSession();
    const bundle = handoffModule.createHandoff(session, {
      description: 'Pick up the import flow.',
    });
    const exportPath = path.join(workDir, '.icopilot-handoff.json');

    const written = handoffModule.exportHandoffFile(bundle, exportPath);
    const importedBundle = handoffModule.importHandoffFile(written);
    const preview = handoffModule.previewHandoff(importedBundle);
    const importedSession = handoffModule.receiveHandoff(importedBundle);
    const memory = new PersistentMemoryCtor();
    memory.load(memory.getProjectId(workDir));

    expect(written).toBe(exportPath);
    expect(fs.existsSync(written)).toBe(true);
    expect(preview).toContain('Handoff bundle');
    expect(preview).toContain('messages: 3');
    expect(importedSession.state.id).not.toBe(session.state.id);
    expect(importedSession.state.mode).toBe('plan');
    expect(importedSession.state.messages[0]).toMatchObject({
      role: 'system',
    });
    expect(String(importedSession.state.messages[0]?.content)).toContain(
      'Imported handoff bundle context',
    );
    expect(memory.recall().map((entry) => entry.key)).toEqual(['owner', 'recent-fix']);
  });

  it('rejects unsupported bundle versions', () => {
    const invalidPath = path.join(workDir, 'invalid-handoff.json');
    fs.writeFileSync(
      invalidPath,
      JSON.stringify({
        version: 99,
        session: {},
        context: {},
        metadata: {},
      }),
      'utf8',
    );

    expect(() => handoffModule.importHandoffFile(invalidPath)).toThrow(
      'Unsupported handoff bundle version',
    );
  });

  it('wires /handoff help text and command handling into slash commands', () => {
    const slashSource = fs.readFileSync(
      path.join(process.cwd(), 'src', 'commands', 'slash.ts'),
      'utf8',
    );

    expect(slashSource).toContain('/handoff export [path]');
    expect(slashSource).toContain('/handoff import <path>');
    expect(slashSource).toContain('/handoff preview <path>');
    expect(slashSource).toContain("case 'handoff':");
    expect(slashSource).toContain("action === 'export'");
    expect(slashSource).toContain("action === 'import'");
    expect(slashSource).toContain("action === 'preview'");
  });

  it('includes /handoff in generated shell completions', async () => {
    const { bashCompletion, defaultContext, pwshCompletion, zshCompletion } =
      await import('../../src/util/completion.js');
    const ctx = defaultContext();

    expect(ctx.slashCommands).toContain('handoff');
    expect(bashCompletion(ctx)).toContain('/handoff');
    expect(zshCompletion(ctx)).toContain('/handoff');
    expect(pwshCompletion(ctx)).toContain('/handoff');
  });
});
