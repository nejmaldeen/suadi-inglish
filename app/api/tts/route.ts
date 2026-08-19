import {
  generateElevenLabsSpeech,
  type ElevenLabsEnvironment,
  type Fetcher,
  VoiceConfigurationError,
} from "../../../lib/voice/elevenlabs.ts";
import { getVoiceScript } from "../../../lib/voice/scripts.ts";

const audioCache = new Map<string, Uint8Array>();

async function readVoiceEnvironment(): Promise<ElevenLabsEnvironment> {
  try {
    const workers = await import("cloudflare:workers");
    return workers.env as unknown as ElevenLabsEnvironment;
  } catch {
    return process.env as unknown as ElevenLabsEnvironment;
  }
}

function errorResponse(status: number, message: string) {
  return Response.json({ error: message }, { status });
}

function audioResponse(audio: Uint8Array) {
  const body = audio.slice().buffer;
  return new Response(body, {
    status: 200,
    headers: {
      "Content-Type": "audio/mpeg",
      "Cache-Control": "no-store",
    },
  });
}

type TtsHandlerDependencies = {
  cache?: Map<string, Uint8Array>;
  environment?: () => Promise<ElevenLabsEnvironment>;
  fetcher?: Fetcher;
};

export function createTtsPostHandler(dependencies: TtsHandlerDependencies = {}) {
  const cache = dependencies.cache ?? audioCache;
  const environment = dependencies.environment ?? readVoiceEnvironment;

  return async function post(request: Request) {
    let body: unknown;

    try {
      body = await request.json();
    } catch {
      return errorResponse(400, "Invalid voice request.");
    }

    if (
      !body ||
      typeof body !== "object" ||
      Array.isArray(body) ||
      Object.keys(body).length !== 1 ||
      typeof (body as { scriptId?: unknown }).scriptId !== "string"
    ) {
      return errorResponse(400, "Invalid voice request.");
    }

    const scriptId = (body as { scriptId: string }).scriptId;
    const script = getVoiceScript(scriptId);
    if (!script) return errorResponse(400, "Unknown voice script.");

    const cached = cache.get(scriptId);
    if (cached) return audioResponse(cached);

    try {
      const audio = await generateElevenLabsSpeech(script, await environment(), dependencies.fetcher);
      cache.set(scriptId, audio);
      return audioResponse(audio);
    } catch (error) {
      if (error instanceof VoiceConfigurationError) {
        return errorResponse(503, "Voice service is unavailable.");
      }
      return errorResponse(502, "Voice generation failed.");
    }
  };
}

export const POST = createTtsPostHandler();
