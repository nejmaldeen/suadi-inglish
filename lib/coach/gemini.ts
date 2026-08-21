import { COACH_RESULT_JSON_SCHEMA, type CoachRequest } from "./contracts.ts";
import {
  CoachConfigurationError,
  CoachProviderError,
  parseAndValidateCoachResult,
  type CoachEnvironment,
  type CoachFetcher,
} from "./openai.ts";
import { buildCoachInput, buildCoachInstructions } from "./prompt.ts";
import { getCoachScenario } from "./scenarios/coffee-v1.ts";

const GEMINI_INTERACTIONS_URL = "https://generativelanguage.googleapis.com/v1beta/interactions";
export const DEFAULT_GEMINI_MODEL = "gemini-3.5-flash-lite";

function getGeminiOutputText(payload: unknown) {
  if (typeof payload !== "object" || payload === null) return undefined;
  const record = payload as { output_text?: unknown; status?: unknown; steps?: unknown };
  if (record.status !== undefined && record.status !== "completed") return undefined;
  if (typeof record.output_text === "string") return record.output_text;
  if (!Array.isArray(record.steps)) return undefined;

  for (let index = record.steps.length - 1; index >= 0; index -= 1) {
    const step = record.steps[index];
    if (typeof step !== "object" || step === null) continue;
    const candidate = step as { type?: unknown; content?: unknown };
    if (candidate.type !== "model_output" || !Array.isArray(candidate.content)) continue;
    const text = candidate.content.flatMap((part) => {
      if (typeof part !== "object" || part === null) return [];
      const content = part as { type?: unknown; text?: unknown };
      return content.type === "text" && typeof content.text === "string" ? [content.text] : [];
    }).join("");
    if (text) return text;
  }
  return undefined;
}

export async function generateCoachResultWithGemini(
  request: CoachRequest,
  environment: CoachEnvironment,
  fetcher: CoachFetcher = fetch,
) {
  const apiKey = environment.GEMINI_API_KEY?.trim();
  if (!apiKey) throw new CoachConfigurationError();

  const scenario = getCoachScenario(request.scenarioId);
  if (!scenario) throw new CoachProviderError();

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 25_000);

  try {
    const response = await fetcher(GEMINI_INTERACTIONS_URL, {
      method: "POST",
      signal: controller.signal,
      headers: {
        "x-goog-api-key": apiKey,
        "Content-Type": "application/json",
        Accept: "application/json",
      },
      body: JSON.stringify({
        model: environment.GEMINI_MODEL?.trim() || DEFAULT_GEMINI_MODEL,
        input: buildCoachInput(request),
        system_instruction: buildCoachInstructions(request, scenario),
        store: false,
        generation_config: {
          max_output_tokens: 1_600,
          thinking_level: "minimal",
          thinking_summaries: "none",
        },
        response_format: {
          type: "text",
          mime_type: "application/json",
          schema: COACH_RESULT_JSON_SCHEMA.schema,
        },
      }),
    });
    if (!response.ok) throw new CoachProviderError(response.status);

    const outputText = getGeminiOutputText(await response.json());
    if (!outputText) throw new CoachProviderError();
    return parseAndValidateCoachResult(request, outputText);
  } catch (error) {
    if (error instanceof CoachConfigurationError || error instanceof CoachProviderError) throw error;
    throw new CoachProviderError();
  } finally {
    clearTimeout(timeout);
  }
}
