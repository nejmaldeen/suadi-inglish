export type SpeechEnvironment = {
  ELEVENLABS_API_KEY?: string;
};

export type SpeechFetcher = (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>;

export class SpeechConfigurationError extends Error {
  constructor() {
    super("Speech transcription service is unavailable.");
    this.name = "SpeechConfigurationError";
  }
}

export class SpeechProviderError extends Error {
  readonly status?: number;

  constructor(status?: number) {
    super("Speech transcription provider failed.");
    this.name = "SpeechProviderError";
    this.status = status;
  }
}

export class NoSpeechError extends Error {
  constructor() {
    super("No speech was detected.");
    this.name = "NoSpeechError";
  }
}

export type SpeechTranscript = {
  text: string;
  languageCode?: string;
};

export async function transcribeWithElevenLabs(
  audio: File,
  environment: SpeechEnvironment,
  fetcher: SpeechFetcher = fetch,
): Promise<SpeechTranscript> {
  const apiKey = environment.ELEVENLABS_API_KEY?.trim();
  if (!apiKey) throw new SpeechConfigurationError();

  const formData = new FormData();
  formData.append("file", audio, audio.name || "speech.webm");
  formData.append("model_id", "scribe_v2");
  formData.append("tag_audio_events", "false");

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 30_000);

  try {
    const response = await fetcher("https://api.elevenlabs.io/v1/speech-to-text", {
      method: "POST",
      signal: controller.signal,
      headers: {
        "xi-api-key": apiKey,
        Accept: "application/json",
      },
      body: formData,
    });
    if (!response.ok) throw new SpeechProviderError(response.status);

    const payload = (await response.json()) as { text?: unknown; language_code?: unknown };
    const text = typeof payload.text === "string" ? payload.text.trim() : "";
    if (!text) throw new NoSpeechError();

    return {
      text,
      ...(typeof payload.language_code === "string" ? { languageCode: payload.language_code } : {}),
    };
  } catch (error) {
    if (error instanceof NoSpeechError || error instanceof SpeechProviderError) throw error;
    throw new SpeechProviderError();
  } finally {
    clearTimeout(timeout);
  }
}
