export const MAX_SPEECH_FILE_BYTES = 10 * 1024 * 1024;

export const ACCEPTED_SPEECH_MIME_TYPES = new Set([
  "audio/mp4",
  "audio/mpeg",
  "audio/ogg",
  "audio/wav",
  "audio/webm",
  "audio/x-m4a",
]);

export type SpeechInputStatus =
  | "ready"
  | "listening"
  | "processing"
  | "completed"
  | "error";

export type SpeechInputErrorCode =
  | "unsupported"
  | "microphone_permission"
  | "microphone_unavailable"
  | "no_audio"
  | "invalid_audio"
  | "audio_too_large"
  | "provider_failed"
  | "network_failed";

export type SpeechInputState = {
  status: SpeechInputStatus;
  transcript: string;
  errorCode?: SpeechInputErrorCode;
};

export type SpeechTranscriptResponse = {
  text: string;
  languageCode?: string;
};

export const SPEECH_STATUS_LABELS: Record<SpeechInputStatus, string> = {
  ready: "جاهز",
  listening: "يستمع",
  processing: "يعالج الصوت",
  completed: "اكتمل",
  error: "حدث خطأ",
};
