export type PlaybackSource = "api" | "file" | "speech" | "timer" | "cancelled";

type PlaybackAttempt = () => Promise<boolean>;

type PlaybackFallbackOptions = {
  signal: AbortSignal;
  api: PlaybackAttempt;
  file: PlaybackAttempt;
  speech: PlaybackAttempt;
  timer: () => Promise<void>;
};

export async function runPlaybackFallback({
  signal,
  api,
  file,
  speech,
  timer,
}: PlaybackFallbackOptions): Promise<PlaybackSource> {
  const attempts: Array<[Exclude<PlaybackSource, "timer" | "cancelled">, PlaybackAttempt]> = [
    ["api", api],
    ["file", file],
    ["speech", speech],
  ];

  for (const [source, attempt] of attempts) {
    if (signal.aborted) return "cancelled";
    try {
      if (await attempt()) return source;
    } catch {
      // Move to the next local fallback without exposing provider details.
    }
  }

  if (signal.aborted) return "cancelled";
  await timer();
  return signal.aborted ? "cancelled" : "timer";
}
