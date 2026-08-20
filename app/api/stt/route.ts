import {
  NoSpeechError,
  SpeechConfigurationError,
  transcribeWithElevenLabs,
  type SpeechEnvironment,
  type SpeechFetcher,
} from "../../../lib/speech/elevenlabs.ts";
import {
  ACCEPTED_SPEECH_MIME_TYPES,
  MAX_SPEECH_FILE_BYTES,
} from "../../../lib/speech/contracts.ts";

async function readSpeechEnvironment(): Promise<SpeechEnvironment> {
  try {
    const workers = await import("cloudflare:workers");
    return workers.env as unknown as SpeechEnvironment;
  } catch {
    return process.env as unknown as SpeechEnvironment;
  }
}

function errorResponse(status: number, code: string, message: string) {
  return Response.json({ code, error: message }, { status, headers: { "Cache-Control": "no-store" } });
}

type SttHandlerDependencies = {
  environment?: () => Promise<SpeechEnvironment>;
  fetcher?: SpeechFetcher;
};

export function createSttPostHandler(dependencies: SttHandlerDependencies = {}) {
  const environment = dependencies.environment ?? readSpeechEnvironment;

  return async function post(request: Request) {
    const rawContentType = request.headers.get("Content-Type") ?? "";
    const mimeType = rawContentType.split(";", 1)[0].trim().toLowerCase();
    if (!rawContentType) {
      return errorResponse(400, "missing_audio", "An audio file is required.");
    }
    if (!ACCEPTED_SPEECH_MIME_TYPES.has(mimeType)) {
      return errorResponse(415, "invalid_audio", "Unsupported audio format.");
    }
    const declaredSize = Number(request.headers.get("Content-Length"));
    if (Number.isFinite(declaredSize) && declaredSize > MAX_SPEECH_FILE_BYTES) {
      return errorResponse(413, "audio_too_large", "The audio file is too large.");
    }

    let audioBytes: ArrayBuffer;
    try {
      audioBytes = await request.arrayBuffer();
    } catch {
      return errorResponse(400, "invalid_audio", "Invalid speech request.");
    }
    if (audioBytes.byteLength === 0) {
      return errorResponse(422, "no_speech", "No speech was detected.");
    }
    if (audioBytes.byteLength > MAX_SPEECH_FILE_BYTES) {
      return errorResponse(413, "audio_too_large", "The audio file is too large.");
    }

    const requestedName = request.headers.get("X-Audio-Filename")?.trim() || "speech";
    const safeName = requestedName.replace(/[^a-zA-Z0-9._-]/g, "_").slice(0, 80) || "speech";
    const audio = new File([audioBytes], safeName, { type: mimeType });

    try {
      const transcript = await transcribeWithElevenLabs(
        audio,
        await environment(),
        dependencies.fetcher,
      );
      return Response.json(transcript, {
        status: 200,
        headers: { "Cache-Control": "no-store" },
      });
    } catch (error) {
      if (error instanceof SpeechConfigurationError) {
        return errorResponse(503, "service_unavailable", "Speech transcription is unavailable.");
      }
      if (error instanceof NoSpeechError) {
        return errorResponse(422, "no_speech", "No speech was detected.");
      }
      return errorResponse(502, "provider_failed", "Speech transcription failed.");
    }
  };
}

export const POST = createSttPostHandler();
