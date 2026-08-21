import {
  CoachValidationError,
  MAX_COACH_REQUEST_BYTES,
  parseCoachRequest,
} from "../../../lib/coach/contracts.ts";
import {
  CoachConfigurationError,
  CoachProviderError,
  type CoachEnvironment,
  type CoachFetcher,
} from "../../../lib/coach/openai.ts";
import { generateCoachResult } from "../../../lib/coach/provider.ts";
import { getCoachScenario } from "../../../lib/coach/scenarios/coffee-v1.ts";

async function readCoachEnvironment(): Promise<CoachEnvironment> {
  try {
    const workers = await import("cloudflare:workers");
    return workers.env as unknown as CoachEnvironment;
  } catch {
    return process.env as unknown as CoachEnvironment;
  }
}

function errorResponse(status: number, code: string, message: string) {
  return Response.json({ code, error: message }, {
    status,
    headers: { "Cache-Control": "no-store" },
  });
}

type CoachHandlerDependencies = {
  environment?: () => Promise<CoachEnvironment>;
  fetcher?: CoachFetcher;
};

export function createCoachPostHandler(dependencies: CoachHandlerDependencies = {}) {
  const environment = dependencies.environment ?? readCoachEnvironment;

  return async function post(request: Request) {
    const contentType = request.headers.get("Content-Type")?.split(";", 1)[0].trim().toLowerCase();
    if (contentType !== "application/json") {
      return errorResponse(415, "invalid_content_type", "A JSON coach request is required.");
    }
    const declaredSize = Number(request.headers.get("Content-Length"));
    if (Number.isFinite(declaredSize) && declaredSize > MAX_COACH_REQUEST_BYTES) {
      return errorResponse(413, "request_too_large", "The coach request is too large.");
    }

    let rawBody: string;
    try {
      rawBody = await request.text();
    } catch {
      return errorResponse(400, "invalid_request", "Invalid coach request.");
    }
    if (new TextEncoder().encode(rawBody).byteLength > MAX_COACH_REQUEST_BYTES) {
      return errorResponse(413, "request_too_large", "The coach request is too large.");
    }

    let coachRequest;
    try {
      coachRequest = parseCoachRequest(JSON.parse(rawBody));
    } catch (error) {
      if (error instanceof CoachValidationError) {
        return errorResponse(400, error.code, error.message);
      }
      return errorResponse(400, "invalid_request", "Invalid coach request.");
    }

    const scenario = getCoachScenario(coachRequest.scenarioId);
    if (!scenario) return errorResponse(400, "unknown_scenario", "Unknown coach scenario.");
    if (coachRequest.learnerLevel !== scenario.learnerLevel ||
      coachRequest.targetSentence !== scenario.targetSentence) {
      return errorResponse(400, "invalid_scenario_contract", "Invalid coach scenario contract.");
    }

    try {
      const result = await generateCoachResult(
        coachRequest,
        await environment(),
        dependencies.fetcher,
      );
      return Response.json(result, {
        status: 200,
        headers: { "Cache-Control": "no-store" },
      });
    } catch (error) {
      if (error instanceof CoachConfigurationError) {
        return errorResponse(503, "service_unavailable", "Coach service is unavailable.");
      }
      if (error instanceof CoachProviderError) {
        return errorResponse(502, "provider_failed", "Coach response generation failed.");
      }
      return errorResponse(502, "provider_failed", "Coach response generation failed.");
    }
  };
}

export const POST = createCoachPostHandler();
