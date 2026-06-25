export interface SpeechProvider {
  transcribe(audio: Buffer | NodeJS.ReadableStream): Promise<string>;
}

export const noopSpeechProvider: SpeechProvider = {
  async transcribe() {
    throw new Error('Voice input not configured. See docs/future.md.');
  },
};

let _provider: SpeechProvider = noopSpeechProvider;

export function registerSpeechProvider(p: SpeechProvider): void {
  _provider = p;
}

export function getSpeechProvider(): SpeechProvider {
  return _provider;
}
