import {
  ACCEPTED_SPEECH_MIME_TYPES,
  MAX_SPEECH_FILE_BYTES,
  type SpeechInputErrorCode,
  type SpeechInputState,
  type SpeechTranscriptResponse,
} from "./contracts.ts";

type RecorderLike = {
  mimeType: string;
  state: string;
  ondataavailable: ((event: BlobEvent) => void) | null;
  onerror: (() => void) | null;
  onstop: (() => void) | null;
  requestData?: () => void;
  start: () => void;
  stop: () => void;
};

type MediaDevicesLike = {
  getUserMedia: (constraints: MediaStreamConstraints) => Promise<MediaStream>;
};

export type PushToTalkDependencies = {
  endpoint?: string;
  fetcher?: typeof fetch;
  mediaDevices?: MediaDevicesLike;
  createRecorder?: (stream: MediaStream, options?: MediaRecorderOptions) => RecorderLike;
  chooseMimeType?: () => string | undefined;
};

export type PushToTalkController = {
  start: () => Promise<void>;
  stop: () => void;
  reset: () => void;
  dispose: () => void;
  getState: () => SpeechInputState;
};

const MIME_TYPE_PREFERENCES = [
  "audio/webm;codecs=opus",
  "audio/ogg;codecs=opus",
  "audio/mp4",
];

function defaultMimeType() {
  if (typeof MediaRecorder === "undefined") return undefined;
  return MIME_TYPE_PREFERENCES.find((mimeType) => MediaRecorder.isTypeSupported(mimeType));
}

function baseMimeType(mimeType: string) {
  return mimeType.split(";", 1)[0].trim().toLowerCase();
}

function extensionFor(mimeType: string) {
  switch (baseMimeType(mimeType)) {
    case "audio/mp4":
    case "audio/x-m4a":
      return "m4a";
    case "audio/ogg":
      return "ogg";
    case "audio/mpeg":
      return "mp3";
    case "audio/wav":
      return "wav";
    default:
      return "webm";
  }
}

function providerErrorCode(status: number, payload: unknown): SpeechInputErrorCode {
  const code =
    payload && typeof payload === "object" && "code" in payload
      ? (payload as { code?: unknown }).code
      : undefined;

  if (code === "no_speech") return "no_audio";
  if (code === "audio_too_large" || status === 413) return "audio_too_large";
  if (code === "invalid_audio" || status === 400 || status === 415 || status === 422) {
    return "invalid_audio";
  }
  return "provider_failed";
}

export function createPushToTalkController(
  onState: (state: SpeechInputState) => void,
  dependencies: PushToTalkDependencies = {},
): PushToTalkController {
  const fetcher = dependencies.fetcher ?? fetch;
  const endpoint = dependencies.endpoint ?? "/api/stt";
  let state: SpeechInputState = { status: "ready", transcript: "" };
  let recorder: RecorderLike | null = null;
  let stream: MediaStream | null = null;
  let chunks: Blob[] = [];
  let cancelled = false;
  let request: AbortController | null = null;

  const update = (next: SpeechInputState) => {
    state = next;
    onState(next);
  };

  const releaseStream = () => {
    stream?.getTracks().forEach((track) => track.stop());
    stream = null;
  };

  const fail = (errorCode: SpeechInputErrorCode) => {
    releaseStream();
    recorder = null;
    chunks = [];
    update({ status: "error", transcript: "", errorCode });
  };

  const transcribe = async (audio: Blob) => {
    if (audio.size === 0) {
      fail("no_audio");
      return;
    }
    if (audio.size > MAX_SPEECH_FILE_BYTES) {
      fail("audio_too_large");
      return;
    }

    const mimeType = baseMimeType(audio.type);
    if (!ACCEPTED_SPEECH_MIME_TYPES.has(mimeType)) {
      fail("invalid_audio");
      return;
    }

    update({ status: "processing", transcript: "" });
    request = new AbortController();

    try {
      const response = await fetcher(endpoint, {
        method: "POST",
        headers: {
          "Content-Type": mimeType,
          "X-Audio-Filename": `speech.${extensionFor(mimeType)}`,
        },
        body: audio,
        signal: request.signal,
      });
      const payload = (await response.json().catch(() => null)) as SpeechTranscriptResponse | null;
      if (!response.ok) {
        fail(providerErrorCode(response.status, payload));
        return;
      }

      const transcript = payload?.text?.trim() ?? "";
      if (!transcript) {
        fail("no_audio");
        return;
      }
      update({ status: "completed", transcript });
    } catch (error) {
      if (!cancelled && (error as { name?: string }).name !== "AbortError") fail("network_failed");
    } finally {
      request = null;
      chunks = [];
    }
  };

  const start = async () => {
    if (state.status === "listening" || state.status === "processing") return;
    const mediaDevices = dependencies.mediaDevices ?? globalThis.navigator?.mediaDevices;
    const createRecorder =
      dependencies.createRecorder ??
      ((mediaStream: MediaStream, options?: MediaRecorderOptions) =>
        new MediaRecorder(mediaStream, options) as unknown as RecorderLike);

    if (!mediaDevices || (typeof MediaRecorder === "undefined" && !dependencies.createRecorder)) {
      fail("unsupported");
      return;
    }

    cancelled = false;
    chunks = [];
    try {
      stream = await mediaDevices.getUserMedia({ audio: true });
      const mimeType = (dependencies.chooseMimeType ?? defaultMimeType)();
      const activeRecorder = createRecorder(stream, mimeType ? { mimeType } : undefined);
      recorder = activeRecorder;
      activeRecorder.ondataavailable = (event) => {
        if (event.data.size > 0) chunks.push(event.data);
      };
      activeRecorder.onerror = () => fail("microphone_unavailable");
      activeRecorder.onstop = () => {
        const recordedMimeType = activeRecorder.mimeType || mimeType || chunks[0]?.type || "audio/webm";
        recorder = null;
        releaseStream();
        if (cancelled) {
          chunks = [];
          return;
        }
        const audio = new Blob(chunks, { type: recordedMimeType });
        void transcribe(audio);
      };
      activeRecorder.start();
      update({ status: "listening", transcript: "" });
    } catch (error) {
      const name = (error as { name?: string }).name;
      fail(name === "NotAllowedError" || name === "SecurityError" ? "microphone_permission" : "microphone_unavailable");
    }
  };

  const stop = () => {
    if (!recorder || recorder.state === "inactive") return;
    recorder.requestData?.();
    recorder.stop();
  };

  const reset = () => {
    cancelled = true;
    request?.abort();
    if (recorder && recorder.state !== "inactive") recorder.stop();
    releaseStream();
    recorder = null;
    chunks = [];
    update({ status: "ready", transcript: "" });
  };

  return { start, stop, reset, dispose: reset, getState: () => state };
}
