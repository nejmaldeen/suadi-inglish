export type ElevenLabsEnvironment = {
  ELEVENLABS_API_KEY?: string;
  ELEVENLABS_VOICE_ID?: string;
  ELEVENLABS_MODEL_ID?: string;
};

export type Fetcher = (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>;

export class VoiceConfigurationError extends Error {
  constructor() {
    super("Voice service is unavailable.");
    this.name = "VoiceConfigurationError";
  }
}

export class VoiceProviderError extends Error {
  constructor() {
    super("Voice provider request failed.");
    this.name = "VoiceProviderError";
  }
}

export async function generateElevenLabsSpeech(
  text: string,
  environment: ElevenLabsEnvironment,
  fetcher: Fetcher = fetch,
) {
  const apiKey = environment.ELEVENLABS_API_KEY?.trim();
  const voiceId = environment.ELEVENLABS_VOICE_ID?.trim();
  const modelId = environment.ELEVENLABS_MODEL_ID?.trim();

  if (!apiKey || !voiceId || !modelId) throw new VoiceConfigurationError();

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 20_000);

  try {
    const response = await fetcher(
      `https://api.elevenlabs.io/v1/text-to-speech/${encodeURIComponent(voiceId)}?output_format=mp3_44100_128`,
      {
        method: "POST",
        signal: controller.signal,
        headers: {
          "xi-api-key": apiKey,
          "Content-Type": "application/json",
          Accept: "audio/mpeg",
        },
        body: JSON.stringify({ text, model_id: modelId }),
      },
    );

    if (!response.ok) throw new VoiceProviderError();

    const audio = new Uint8Array(await response.arrayBuffer());
    if (audio.byteLength === 0) throw new VoiceProviderError();
    return audio;
  } catch (error) {
    if (error instanceof VoiceProviderError) throw error;
    throw new VoiceProviderError();
  } finally {
    clearTimeout(timeout);
  }
}
