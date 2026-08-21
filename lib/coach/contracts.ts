export const COACH_SCENARIO_IDS = ["coffee-v1"] as const;
export const LEARNER_LEVELS = ["A2"] as const;
export const COACH_MODES = ["normal", "strict", "hook"] as const;
export const COACH_HISTORY_ROLES = ["learner", "coach"] as const;
export const COACH_ISSUE_TYPES = ["hesitation", "grammar", "word_choice", "clarification"] as const;

export const MAX_TRANSCRIPT_CHARS = 600;
export const MAX_TARGET_SENTENCE_CHARS = 200;
export const MAX_CONVERSATION_HISTORY_ITEMS = 6;
export const MAX_CONVERSATION_TURN_CHARS = 400;
export const MAX_COACH_REQUEST_BYTES = 16_384;

export type CoachScenarioId = (typeof COACH_SCENARIO_IDS)[number];
export type LearnerLevel = (typeof LEARNER_LEVELS)[number];
export type CoachMode = (typeof COACH_MODES)[number];
export type CoachHistoryRole = (typeof COACH_HISTORY_ROLES)[number];
export type CoachIssueType = (typeof COACH_ISSUE_TYPES)[number];

export type ConversationTurn = { role: CoachHistoryRole; text: string };

export type CoachRequest = {
  scenarioId: CoachScenarioId;
  learnerLevel: LearnerLevel;
  rawTranscript: string;
  targetSentence: string;
  coachMode: CoachMode;
  conversationHistory?: ConversationTurn[];
};

export type DetectedIssue = {
  type: CoachIssueType;
  evidence: string;
  explanationArabic: string;
};

export type CoachResult = {
  rawTranscript: string;
  cleanedTranscript: string;
  probableIntent: string;
  needsClarification: boolean;
  confidence: number;
  detectedIssues: DetectedIssue[];
  correctedSentence: string;
  explanationArabic: string;
  practiceSentenceEnglish: string;
  coachReplyArabic: string;
  coachReplyEnglish: string;
  expressiveTtsText: string;
  coachMode: CoachMode;
  shouldTryAgain: boolean;
};

type UnknownRecord = Record<string, unknown>;

export class CoachValidationError extends Error {
  readonly code: string;

  constructor(code = "invalid_request", message = "Invalid coach request.") {
    super(message);
    this.name = "CoachValidationError";
    this.code = code;
  }
}

function isRecord(value: unknown): value is UnknownRecord {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function hasOnlyKeys(value: UnknownRecord, required: string[], optional: string[] = []) {
  const keys = Object.keys(value);
  return required.every((key) => keys.includes(key)) &&
    keys.every((key) => required.includes(key) || optional.includes(key));
}

function isBoundedString(value: unknown, maximum: number): value is string {
  return typeof value === "string" && value.length <= maximum && value.trim().length > 0;
}

function isOneOf<const T extends readonly string[]>(value: unknown, options: T): value is T[number] {
  return typeof value === "string" && (options as readonly string[]).includes(value);
}

function parseConversationHistory(value: unknown): ConversationTurn[] | undefined {
  if (value === undefined) return undefined;
  if (!Array.isArray(value) || value.length > MAX_CONVERSATION_HISTORY_ITEMS) {
    throw new CoachValidationError();
  }

  return value.map((turn) => {
    if (!isRecord(turn) || !hasOnlyKeys(turn, ["role", "text"]) ||
      !isOneOf(turn.role, COACH_HISTORY_ROLES) ||
      !isBoundedString(turn.text, MAX_CONVERSATION_TURN_CHARS)) {
      throw new CoachValidationError();
    }
    return { role: turn.role, text: turn.text };
  });
}

export function parseCoachRequest(value: unknown): CoachRequest {
  if (!isRecord(value) || !hasOnlyKeys(
    value,
    ["scenarioId", "learnerLevel", "rawTranscript", "targetSentence", "coachMode"],
    ["conversationHistory"],
  )) {
    throw new CoachValidationError();
  }
  if (!isOneOf(value.scenarioId, COACH_SCENARIO_IDS)) {
    throw new CoachValidationError("unknown_scenario", "Unknown coach scenario.");
  }
  if (!isOneOf(value.coachMode, COACH_MODES)) {
    throw new CoachValidationError("unknown_coach_mode", "Unknown coach mode.");
  }
  if (!isOneOf(value.learnerLevel, LEARNER_LEVELS) ||
    !isBoundedString(value.rawTranscript, MAX_TRANSCRIPT_CHARS) ||
    !isBoundedString(value.targetSentence, MAX_TARGET_SENTENCE_CHARS)) {
    throw new CoachValidationError();
  }

  const conversationHistory = parseConversationHistory(value.conversationHistory);
  return {
    scenarioId: value.scenarioId,
    learnerLevel: value.learnerLevel,
    rawTranscript: value.rawTranscript,
    targetSentence: value.targetSentence,
    coachMode: value.coachMode,
    ...(conversationHistory ? { conversationHistory } : {}),
  };
}

const STRING_LIMITS = {
  rawTranscript: MAX_TRANSCRIPT_CHARS,
  cleanedTranscript: MAX_TRANSCRIPT_CHARS,
  probableIntent: 240,
  correctedSentence: MAX_TRANSCRIPT_CHARS,
  explanationArabic: 800,
  practiceSentenceEnglish: 400,
  coachReplyArabic: 800,
  coachReplyEnglish: 600,
  expressiveTtsText: 1_400,
} as const;

const RESULT_KEYS = [
  "rawTranscript", "cleanedTranscript", "probableIntent", "needsClarification", "confidence",
  "detectedIssues", "correctedSentence", "explanationArabic", "practiceSentenceEnglish",
  "coachReplyArabic", "coachReplyEnglish", "expressiveTtsText", "coachMode", "shouldTryAgain",
] as const;

function parseDetectedIssues(value: unknown): DetectedIssue[] {
  if (!Array.isArray(value) || value.length > 1) throw new CoachValidationError("invalid_provider_output");
  return value.map((issue) => {
    if (!isRecord(issue) || !hasOnlyKeys(issue, ["type", "evidence", "explanationArabic"]) ||
      !isOneOf(issue.type, COACH_ISSUE_TYPES) ||
      !isBoundedString(issue.evidence, 240) ||
      !isBoundedString(issue.explanationArabic, 500)) {
      throw new CoachValidationError("invalid_provider_output");
    }
    return { type: issue.type, evidence: issue.evidence, explanationArabic: issue.explanationArabic };
  });
}

export function parseCoachResult(value: unknown): CoachResult {
  if (!isRecord(value) || !hasOnlyKeys(value, [...RESULT_KEYS])) {
    throw new CoachValidationError("invalid_provider_output");
  }
  for (const [key, maximum] of Object.entries(STRING_LIMITS)) {
    if (!isBoundedString(value[key], maximum)) throw new CoachValidationError("invalid_provider_output");
  }
  if (typeof value.needsClarification !== "boolean" ||
    typeof value.shouldTryAgain !== "boolean" ||
    typeof value.confidence !== "number" || !Number.isFinite(value.confidence) ||
    value.confidence < 0 || value.confidence > 1 ||
    !isOneOf(value.coachMode, COACH_MODES)) {
    throw new CoachValidationError("invalid_provider_output");
  }

  return {
    rawTranscript: value.rawTranscript as string,
    cleanedTranscript: value.cleanedTranscript as string,
    probableIntent: value.probableIntent as string,
    needsClarification: value.needsClarification,
    confidence: value.confidence,
    detectedIssues: parseDetectedIssues(value.detectedIssues),
    correctedSentence: value.correctedSentence as string,
    explanationArabic: value.explanationArabic as string,
    practiceSentenceEnglish: value.practiceSentenceEnglish as string,
    coachReplyArabic: value.coachReplyArabic as string,
    coachReplyEnglish: value.coachReplyEnglish as string,
    expressiveTtsText: value.expressiveTtsText as string,
    coachMode: value.coachMode,
    shouldTryAgain: value.shouldTryAgain,
  };
}

export const COACH_RESULT_JSON_SCHEMA = {
  type: "json_schema",
  name: "coach_result",
  strict: true,
  schema: {
    type: "object",
    additionalProperties: false,
    required: [...RESULT_KEYS],
    properties: {
      rawTranscript: { type: "string" },
      cleanedTranscript: { type: "string" },
      probableIntent: { type: "string" },
      needsClarification: { type: "boolean" },
      confidence: { type: "number", minimum: 0, maximum: 1 },
      detectedIssues: {
        type: "array", maxItems: 1,
        items: {
          type: "object", additionalProperties: false,
          required: ["type", "evidence", "explanationArabic"],
          properties: {
            type: { type: "string", enum: [...COACH_ISSUE_TYPES] },
            evidence: { type: "string" },
            explanationArabic: { type: "string" },
          },
        },
      },
      correctedSentence: { type: "string" },
      explanationArabic: { type: "string" },
      practiceSentenceEnglish: { type: "string" },
      coachReplyArabic: { type: "string" },
      coachReplyEnglish: { type: "string" },
      expressiveTtsText: { type: "string" },
      coachMode: { type: "string", enum: [...COACH_MODES] },
      shouldTryAgain: { type: "boolean" },
    },
  },
} as const;
