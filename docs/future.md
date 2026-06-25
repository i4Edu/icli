# Beyond 1.0 architecture extension points

These roadmap items are intentionally documented as extension points rather than bundled features. Voice STT, real-time team sessions, and marketplace discovery all require product, security, privacy, and dependency choices that are better kept out of the core CLI until they are proven.

All three extension modules use the same pattern:

1. Core exports a small interface.
2. Core registers a no-op or local default.
3. Third-party packages install alongside iCopilot and call `register*()` at startup.

For example:

```ts
import { registerSpeechProvider } from 'icopilot/dist/extensions/voice.js';
```

## Voice input (speech-to-text)

Core stub: `src/extensions/voice.ts`

```ts
export interface SpeechProvider {
  transcribe(audio: Buffer | NodeJS.ReadableStream): Promise<string>;
}

export function registerSpeechProvider(p: SpeechProvider): void;
export function getSpeechProvider(): SpeechProvider;
```

The default provider throws: voice is not configured.

Recommended implementations:

- Local/private: `node-record-lpcm16` for microphone capture plus `whisper.cpp` for transcription.
- Cloud: Azure Speech or Deepgram for managed STT, streaming partials, diarization, and language detection.

### How to plug in a real provider

1. Publish an addon package, for example `@acme/icopilot-whisper`.
2. Implement `SpeechProvider`.
3. Call `registerSpeechProvider()` from the addon entrypoint.
4. Load that addon from user config or a future `/plugin load` command.

Sketch:

```ts
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import fs from 'node:fs/promises';
import path from 'node:path';
import { registerSpeechProvider, type SpeechProvider } from 'icopilot/dist/extensions/voice.js';

class WhisperProvider implements SpeechProvider {
  constructor(
    private readonly whisperBin: string,
    private readonly modelPath: string,
  ) {}

  async transcribe(audio: Buffer | NodeJS.ReadableStream): Promise<string> {
    const workDir = path.join(process.cwd(), '.icopilot', 'voice');
    await fs.mkdir(workDir, { recursive: true });
    const wav = path.join(workDir, `capture-${Date.now()}.wav`);
    if (Buffer.isBuffer(audio)) {
      await fs.writeFile(wav, audio);
    } else {
      const chunks: Buffer[] = [];
      audio.on('data', (chunk) => chunks.push(Buffer.from(chunk)));
      await once(audio, 'end');
      await fs.writeFile(wav, Buffer.concat(chunks));
    }

    const child = spawn(this.whisperBin, ['-m', this.modelPath, '-f', wav, '-otxt'], {
      stdio: ['ignore', 'pipe', 'pipe'],
    });

    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (chunk) => (stdout += chunk));
    child.stderr.on('data', (chunk) => (stderr += chunk));
    const [code] = (await once(child, 'close')) as [number];
    await fs.rm(wav, { force: true });
    if (code !== 0) throw new Error(`whisper.cpp failed: ${stderr}`);
    return stdout.trim();
  }
}

registerSpeechProvider(
  new WhisperProvider(process.env.WHISPER_BIN || 'whisper-cli', process.env.WHISPER_MODEL || 'ggml-base.en.bin'),
);
```

## Team mode (WebRTC/shared sessions)

Core stub: `src/extensions/team.ts`

```ts
export interface TeamTransport {
  connect(roomId: string): Promise<void>;
  send(event: { type: string; data: unknown }): Promise<void>;
  on(handler: (event: { type: string; data: unknown }) => void): void;
  disconnect(): Promise<void>;
}

export function registerTeamTransport(t: TeamTransport): void;
export function getTeamTransport(): TeamTransport;
```

The default transport throws on `connect()` and no-ops for other operations.

Reference architecture 1: WebRTC peer-to-peer

- Use `simple-peer` for data channels.
- Use a tiny HTTPS signalling service to exchange offers/answers/ICE candidates.
- Send append-only events such as `prompt.submitted`, `assistant.token`, `tool.started`, and `session.compacted`.
- Persist only local session state unless participants opt into shared storage.

Sketch:

```ts
import Peer from 'simple-peer';
import { registerTeamTransport, type TeamTransport } from 'icopilot/dist/extensions/team.js';

class WebRtcTransport implements TeamTransport {
  private peer?: Peer.Instance;
  private handlers = new Set<(event: { type: string; data: unknown }) => void>();

  async connect(roomId: string) {
    this.peer = new Peer({ initiator: true, trickle: true });
    this.peer.on('signal', (signal) => fetch(`/rooms/${roomId}/signal`, { method: 'POST', body: JSON.stringify(signal) }));
    this.peer.on('data', (data) => {
      const event = JSON.parse(String(data));
      for (const h of this.handlers) h(event);
    });
  }

  async send(event: { type: string; data: unknown }) {
    this.peer?.send(JSON.stringify(event));
  }

  on(handler: (event: { type: string; data: unknown }) => void) {
    this.handlers.add(handler);
  }

  async disconnect() {
    this.peer?.destroy();
  }
}

registerTeamTransport(new WebRtcTransport());
```

Reference architecture 2: signalling-only Socket.IO

- Use Socket.IO rooms for all events.
- Simpler NAT/firewall behavior than WebRTC.
- Server can enforce auth, rate limits, retention windows, and audit logs.
- Best for enterprise deployments where peer-to-peer traffic is blocked.

## Plugin marketplace

Core stub: `src/extensions/marketplace.ts`

```ts
export interface PluginEntry {
  name: string;
  description: string;
  install: string;
  homepage?: string;
}

export interface PluginCatalog {
  search(query: string): Promise<PluginEntry[]>;
  list(): Promise<PluginEntry[]>;
}

export class LocalPluginCatalog implements PluginCatalog;
export function registerPluginCatalog(c: PluginCatalog): void;
export function getPluginCatalog(): PluginCatalog;
```

The default catalog reads `~/.icopilot/plugins.json` and returns an empty list if it does not exist. This keeps discovery offline-friendly.

The simplest marketplace is a static `index.json` hosted on GitHub Pages:

```json
[
  {
    "name": "@acme/icopilot-whisper",
    "description": "Local whisper.cpp speech-to-text provider for iCopilot.",
    "install": "npm i -g @acme/icopilot-whisper",
    "homepage": "https://github.com/acme/icopilot-whisper"
  },
  {
    "name": "@acme/icopilot-team-socket",
    "description": "Socket.IO shared session transport.",
    "install": "npm i -g @acme/icopilot-team-socket"
  }
]
```

Install flow:

1. User runs a future command such as `/plugins search whisper`.
2. CLI calls `getPluginCatalog().search('whisper')`.
3. CLI displays the `install` command and asks for confirmation.
4. After confirmation, CLI delegates to `npm i -g <package>`.
5. User enables the addon in config; the addon calls the relevant `register*()` hook.

Security notes:

- Never auto-install plugins.
- Show package name, homepage, and install command before execution.
- Prefer signed package provenance and allow enterprise admins to replace the catalog with an internal `PluginCatalog`.
