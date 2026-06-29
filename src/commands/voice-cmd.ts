import { getSpeechProvider, isVoiceInputConfigured } from '../extensions/voice.js';
import { theme } from '../ui/theme.js';

interface VoiceCommandState {
  isRecording: boolean;
  startedAt: number;
  recordedAudio: Buffer | null;
}

const state: VoiceCommandState = {
  isRecording: false,
  startedAt: 0,
  recordedAudio: null,
};

export async function voiceCommand(args: string[]): Promise<string> {
  if (!isVoiceInputConfigured()) {
    return `${theme.err('Voice input is not configured.')}\n\nTo enable voice input, install a speech provider plugin:\n  /plugin install openai-whisper\n\nSee docs/extensions.md for setup instructions.\n`;
  }

  const [subcommand = 'start'] = args;
  const cmd = subcommand.toLowerCase().trim();

  if (cmd === 'start' || cmd === 'record') {
    if (state.isRecording) {
      return theme.warn('Already recording. Use /voice stop to finish.\n');
    }
    return await startRecording();
  }

  if (cmd === 'stop' || cmd === 'end') {
    if (!state.isRecording) {
      return theme.warn('Not currently recording. Use /voice start to begin.\n');
    }
    return await stopRecording();
  }

  if (cmd === 'status') {
    return getStatus();
  }

  if (cmd === 'cancel') {
    if (!state.isRecording) {
      return theme.warn('Not currently recording.\n');
    }
    state.isRecording = false;
    state.recordedAudio = null;
    return theme.ok('✔ Recording cancelled.\n');
  }

  return `usage: /voice [start|stop|status|cancel]\n`;
}

async function startRecording(): Promise<string> {
  state.isRecording = true;
  state.startedAt = Date.now();
  state.recordedAudio = null;

  return theme.dim('🎤 Recording started...\n  (Use /voice stop to finish, Ctrl+C to cancel)\n');
}

async function stopRecording(): Promise<string> {
  if (!state.isRecording) {
    return theme.warn('Not recording.\n');
  }

  state.isRecording = false;
  const elapsed = ((Date.now() - state.startedAt) / 1000).toFixed(1);

  try {
    if (!state.recordedAudio || state.recordedAudio.length === 0) {
      return theme.warn(`Recording incomplete. Try again.\n`);
    }

    const provider = getSpeechProvider();
    const transcribed = await provider.transcribe(state.recordedAudio);
    state.recordedAudio = null;

    if (!transcribed || !transcribed.trim()) {
      return theme.warn(`No speech detected. Try again.\n`);
    }

    return `${theme.ok(`✔ Transcribed (${elapsed}s)`)}\n\n${transcribed}\n`;
  } catch (error) {
    state.recordedAudio = null;
    const message = error instanceof Error ? error.message : String(error);
    return theme.err(`Voice transcription failed: ${message}\n`);
  }
}

function getStatus(): string {
  if (!state.isRecording) {
    return theme.dim('Not recording.\n');
  }

  const elapsed = ((Date.now() - state.startedAt) / 1000).toFixed(1);
  return theme.dim(`🎤 Recording: ${elapsed}s elapsed\n`);
}

export function isRecording(): boolean {
  return state.isRecording;
}

export function setRecordedAudio(audio: Buffer): void {
  state.recordedAudio = audio;
}

export function getRecordedAudio(): Buffer | null {
  return state.recordedAudio;
}

export function resetVoiceState(): void {
  state.isRecording = false;
  state.startedAt = 0;
  state.recordedAudio = null;
}
