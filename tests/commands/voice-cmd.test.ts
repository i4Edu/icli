import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import {
  voiceCommand,
  isRecording,
  setRecordedAudio,
  getRecordedAudio,
  resetVoiceState,
} from '../../src/commands/voice-cmd.js';
import { registerSpeechProvider, type SpeechProvider } from '../../src/extensions/voice.js';

describe('voice-cmd', () => {
  let mockProvider: SpeechProvider;

  beforeEach(() => {
    resetVoiceState();

    mockProvider = {
      transcribe: vi.fn(async () => 'Hello world'),
      isConfigured: vi.fn(() => true),
    };

    registerSpeechProvider(mockProvider);
  });

  afterEach(() => {
    resetVoiceState();
  });

  it('returns error message when provider not configured', async () => {
    const noopProvider: SpeechProvider = {
      transcribe: vi.fn(async () => {
        throw new Error('Not configured');
      }),
      isConfigured: vi.fn(() => false),
    };
    registerSpeechProvider(noopProvider);

    const result = await voiceCommand(['start']);
    expect(result).toContain('Voice input is not configured');
    expect(result).toContain('/plugin install openai-whisper');
  });

  it('starts recording and returns status message', async () => {
    const result = await voiceCommand(['start']);
    expect(result).toContain('Recording started');
    expect(isRecording()).toBe(true);
  });

  it('handles "record" as alias for "start"', async () => {
    const result = await voiceCommand(['record']);
    expect(result).toContain('Recording started');
    expect(isRecording()).toBe(true);
  });

  it('prevents starting recording when already recording', async () => {
    await voiceCommand(['start']);
    const result = await voiceCommand(['start']);
    expect(result).toContain('Already recording');
  });

  it('stops recording and transcribes audio', async () => {
    await voiceCommand(['start']);
    setRecordedAudio(Buffer.from('audio data'));

    const result = await voiceCommand(['stop']);
    expect(result).toContain('Transcribed');
    expect(result).toContain('Hello world');
    expect(isRecording()).toBe(false);
  });

  it('handles "end" as alias for "stop"', async () => {
    await voiceCommand(['start']);
    setRecordedAudio(Buffer.from('audio data'));

    const result = await voiceCommand(['end']);
    expect(result).toContain('Transcribed');
  });

  it('prevents stopping when not recording', async () => {
    const result = await voiceCommand(['stop']);
    expect(result).toContain('Not currently recording');
  });

  it('returns status when recording', async () => {
    await voiceCommand(['start']);
    const result = await voiceCommand(['status']);
    expect(result).toContain('Recording:');
  });

  it('returns status when not recording', async () => {
    const result = await voiceCommand(['status']);
    expect(result).toContain('Not recording');
  });

  it('cancels recording', async () => {
    await voiceCommand(['start']);
    expect(isRecording()).toBe(true);

    const result = await voiceCommand(['cancel']);
    expect(result).toContain('Recording cancelled');
    expect(isRecording()).toBe(false);
  });

  it('prevents cancelling when not recording', async () => {
    const result = await voiceCommand(['cancel']);
    expect(result).toContain('Not currently recording');
  });

  it('handles empty audio gracefully', async () => {
    await voiceCommand(['start']);
    setRecordedAudio(Buffer.from(''));

    const result = await voiceCommand(['stop']);
    expect(result).toContain('Recording incomplete');
  });

  it('handles transcription errors gracefully', async () => {
    const errorProvider: SpeechProvider = {
      transcribe: vi.fn(async () => {
        throw new Error('Network error');
      }),
      isConfigured: vi.fn(() => true),
    };
    registerSpeechProvider(errorProvider);

    await voiceCommand(['start']);
    setRecordedAudio(Buffer.from('audio data'));

    const result = await voiceCommand(['stop']);
    expect(result).toContain('Voice transcription failed');
    expect(result).toContain('Network error');
  });

  it('shows usage on invalid subcommand', async () => {
    const result = await voiceCommand(['invalid']);
    expect(result).toContain('usage: /voice');
  });

  it('defaults to "start" when no subcommand given', async () => {
    const result = await voiceCommand([]);
    expect(result).toContain('Recording started');
    expect(isRecording()).toBe(true);
  });

  it('stores and retrieves recorded audio', () => {
    const audio = Buffer.from('test audio');
    setRecordedAudio(audio);
    expect(getRecordedAudio()).toBe(audio);
  });

  it('clears recorded audio on reset', () => {
    setRecordedAudio(Buffer.from('test audio'));
    resetVoiceState();
    expect(getRecordedAudio()).toBeNull();
  });

  it('handles whitespace in subcommand', async () => {
    const result = await voiceCommand(['  start  ']);
    expect(result).toContain('Recording started');
  });

  it('handles case-insensitive subcommands', async () => {
    const result = await voiceCommand(['START']);
    expect(result).toContain('Recording started');
  });
});
