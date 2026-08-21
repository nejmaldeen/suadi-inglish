import type { CoachRequest } from "./contracts.ts";
import { generateCoachResultWithGemini } from "./gemini.ts";
import {
  CoachConfigurationError,
  generateCoachResultWithOpenAI,
  type CoachEnvironment,
  type CoachFetcher,
} from "./openai.ts";

export async function generateCoachResult(
  request: CoachRequest,
  environment: CoachEnvironment,
  fetcher?: CoachFetcher,
) {
  const provider = environment.COACH_PROVIDER?.trim().toLowerCase() || "openai";
  if (provider === "gemini") {
    return generateCoachResultWithGemini(request, environment, fetcher);
  }
  if (provider === "openai") {
    return generateCoachResultWithOpenAI(request, environment, fetcher);
  }
  throw new CoachConfigurationError();
}
