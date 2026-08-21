import {
  COACH_RESULT_JSON_SCHEMA,
  CoachValidationError,
  parseCoachResult,
  type CoachRequest,
  type CoachResult,
} from "./contracts.ts";
import {
  containsOnlyAllowedExpressiveTags,
  countClosedListInsults,
} from "./personas.ts";
import { buildCoachInput, buildCoachInstructions } from "./prompt.ts";
import { getCoachScenario } from "./scenarios/coffee-v1.ts";

const OPENAI_RESPONSES_URL = "https://api.openai.com/v1/responses";
const DEFAULT_OPENAI_MODEL = "gpt-5.6-luna";

export type CoachEnvironment = {
  COACH_PROVIDER?: string;
  GEMINI_API_KEY?: string;
  GEMINI_MODEL?: string;
  OPENAI_API_KEY?: string;
  OPENAI_MODEL?: string;
};

export type CoachFetcher = (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>;

export class CoachConfigurationError extends Error {
  constructor() {
    super("Coach service is unavailable.");
    this.name = "CoachConfigurationError";
  }
}

export class CoachProviderError extends Error {
  readonly status?: number;

  constructor(status?: number) {
    super("Coach provider failed.");
    this.name = "CoachProviderError";
    this.status = status;
  }
}

function getResponseOutputText(payload: unknown) {
  if (typeof payload !== "object" || payload === null) return undefined;
  const record = payload as { output_text?: unknown; output?: unknown };
  if (typeof record.output_text === "string") return record.output_text;
  if (!Array.isArray(record.output)) return undefined;

  for (const item of record.output) {
    if (typeof item !== "object" || item === null) continue;
    const content = (item as { content?: unknown }).content;
    if (!Array.isArray(content)) continue;
    for (const part of content) {
      if (typeof part !== "object" || part === null) continue;
      const candidate = part as { type?: unknown; text?: unknown };
      if (candidate.type === "output_text" && typeof candidate.text === "string") {
        return candidate.text;
      }
    }
  }
  return undefined;
}

function assertResultInvariants(request: CoachRequest, result: CoachResult) {
  if (result.rawTranscript !== request.rawTranscript || result.coachMode !== request.coachMode) {
    throw new CoachProviderError();
  }
  if (!containsOnlyAllowedExpressiveTags(result.expressiveTtsText)) {
    throw new CoachProviderError();
  }

  const textWithPersonaLanguage = [
    result.coachReplyArabic,
    result.coachReplyEnglish,
    result.expressiveTtsText,
  ].join("\n");
  const insultCount = countClosedListInsults(textWithPersonaLanguage);
  if ((request.coachMode !== "hook" && insultCount > 0) || insultCount > 1) {
    throw new CoachProviderError();
  }

  if (/\bvote\b/i.test(request.rawTranscript) &&
    (!/\bvote\b/i.test(result.cleanedTranscript) || !result.needsClarification)) {
    throw new CoachProviderError();
  }
}

export function parseAndValidateCoachResult(request: CoachRequest, outputText: string) {
  let parsed: unknown;
  try {
    parsed = JSON.parse(outputText);
  } catch {
    throw new CoachProviderError();
  }

  let result: CoachResult;
  try {
    result = parseCoachResult(parsed);
  } catch (error) {
    if (error instanceof CoachValidationError) throw new CoachProviderError();
    throw error;
  }
  assertResultInvariants(request, result);
  return result;
}

export async function generateCoachResultWithOpenAI(
  request: CoachRequest,
  environment: CoachEnvironment,
  fetcher: CoachFetcher = fetch,
): Promise<CoachResult> {
  const apiKey = environment.OPENAI_API_KEY?.trim();
  if (!apiKey) throw new CoachConfigurationError();

  const scenario = getCoachScenario(request.scenarioId);
  if (!scenario) throw new CoachProviderError();

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 25_000);

  try {
    const response = await fetcher(OPENAI_RESPONSES_URL, {
      method: "POST",
      signal: controller.signal,
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
        Accept: "application/json",
      },
      body: JSON.stringify({
        model: environment.OPENAI_MODEL?.trim() || DEFAULT_OPENAI_MODEL,
        store: false,
        reasoning: { effort: "none" },
        max_output_tokens: 1_600,
        instructions: buildCoachInstructions(request, scenario),
        input: [{
          role: "user",
          content: [{ type: "input_text", text: buildCoachInput(request) }],
        }],
        text: { format: COACH_RESULT_JSON_SCHEMA, verbosity: "low" },
      }),
    });
    if (!response.ok) throw new CoachProviderError(response.status);

    const outputText = getResponseOutputText(await response.json());
    if (!outputText) throw new CoachProviderError();

    return parseAndValidateCoachResult(request, outputText);
  } catch (error) {
    if (error instanceof CoachConfigurationError || error instanceof CoachProviderError) throw error;
    throw new CoachProviderError();
  } finally {
    clearTimeout(timeout);
  }
}

export const generateCoachResult = generateCoachResultWithOpenAI;
