import type { CoachMode } from "./contracts.ts";

export const HOOK_ALLOWED_INSULTS = [
  "يا أهبل",
  "يا كسلان",
  "يا نائم",
  "يا حيوان",
  "يا كلب",
] as const;

export const ALLOWED_EXPRESSIVE_TAGS = [
  "[angry]",
  "[shouts]",
  "[scoffs]",
  "[sarcastic]",
  "[laughs]",
  "[sighs]",
] as const;

export type CoachPersona = {
  mode: CoachMode;
  instructions: string;
};

export const COACH_PERSONAS: Record<CoachMode, CoachPersona> = {
  normal: {
    mode: "normal",
    instructions: [
      "Be warm, clear, and encouraging.",
      "Do not shout, insult, or use mocking language.",
      "Praise what is correct before giving one concise correction.",
    ].join(" "),
  },
  strict: {
    mode: "strict",
    instructions: [
      "Be firm, fast, and lightly sarcastic without humiliating the learner.",
      "Do not use insults, shouting, threats, or degrading language.",
      "Keep the correction direct and actionable.",
    ].join(" "),
  },
  hook: {
    mode: "hook",
    instructions: [
      "This mode was explicitly selected for theatrical content.",
      "Be dramatic, angry, sarcastic, and highly reactive, while remaining educational.",
      `You may use at most one insult, only if it serves the hook, and only from this closed list: ${HOOK_ALLOWED_INSULTS.join(", ")}.`,
      "Never insult family, religion, tribe, nationality, region, race, or sexuality. Never make a real threat.",
      "Do not invent or use any insult outside the closed list.",
    ].join(" "),
  },
};

export function countClosedListInsults(text: string) {
  return HOOK_ALLOWED_INSULTS.reduce((count, insult) => {
    return count + text.split(insult).length - 1;
  }, 0);
}

export function containsOnlyAllowedExpressiveTags(text: string) {
  const tags = text.match(/\[[^\]]+\]/g) ?? [];
  return tags.every((tag) => (ALLOWED_EXPRESSIVE_TAGS as readonly string[]).includes(tag));
}
