export const VOICE_SCRIPTS = {
  "coffee-v1":
    "حلو، فهمتك. بس خلنا نخليها طبيعية أكثر. I'd like to order a flat white, please. ممتاز! الحين جرّب تقولها مرة ثانية.",
} as const;

export type VoiceScriptId = keyof typeof VOICE_SCRIPTS;

export function getVoiceScript(scriptId: string) {
  if (!Object.prototype.hasOwnProperty.call(VOICE_SCRIPTS, scriptId)) return null;
  return VOICE_SCRIPTS[scriptId as VoiceScriptId];
}
