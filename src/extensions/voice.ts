export interface SpeechProvider {
  transcribe(audio: Buffer | NodeJS.ReadableStream): Promise<string>;
  isConfigured(): boolean;
}

export interface AudioCapture {
  startRecording(): Promise<void>;
  stopRecording(): Promise<Buffer>;
  isRecording(): boolean;
  cancel(): void;
}

export const noopSpeechProvider: SpeechProvider = {
  async transcribe() {
    throw new Error(
      'Voice input not configured. Install a speech provider plugin (e.g., openai-whisper) with `/plugin install openai-whisper`.',
    );
  },
  isConfigured() {
    return false;
  },
};

let _provider: SpeechProvider = noopSpeechProvider;

export function registerSpeechProvider(p: SpeechProvider): void {
  _provider = p;
}

export function getSpeechProvider(): SpeechProvider {
  return _provider;
}

export function isVoiceInputConfigured(): boolean {
  return _provider.isConfigured();
}
