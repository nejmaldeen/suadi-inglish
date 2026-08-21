import assert from "node:assert/strict";
import test from "node:test";

import { createCoachPostHandler } from "../app/api/coach/route.ts";

const TARGET = "I’d like to order a flat white, please.";
const GEMINI_ENVIRONMENT = {
  COACH_PROVIDER: "gemini",
  GEMINI_API_KEY: "server-gemini-test-key",
  GEMINI_MODEL: "gemini-3.5-flash-lite",
};

function coachRequest(rawTranscript) {
  return new Request("http://localhost/api/coach", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      scenarioId: "coffee-v1",
      learnerLevel: "A2",
      rawTranscript,
      targetSentence: TARGET,
      coachMode: "normal",
    }),
  });
}

function coachResult(rawTranscript, overrides = {}) {
  return {
    rawTranscript,
    cleanedTranscript: rawTranscript,
    probableIntent: "Communicate in English.",
    needsClarification: false,
    confidence: 0.9,
    detectedIssues: [],
    correctedSentence: rawTranscript,
    explanationArabic: "المحاولة واضحة.",
    practiceSentenceEnglish: rawTranscript,
    coachReplyArabic: "محاولة واضحة.",
    coachReplyEnglish: "Clear attempt.",
    expressiveTtsText: "محاولة واضحة. Clear attempt.",
    coachMode: "normal",
    shouldTryAgain: false,
    ...overrides,
  };
}

function geminiResponse(result) {
  return Response.json({
    object: "interaction",
    status: "completed",
    steps: [{
      type: "model_output",
      content: [{ type: "text", text: JSON.stringify(result) }],
    }],
  });
}

test("Gemini provider uses Interactions Structured Outputs without requiring OpenAI", async () => {
  const rawTranscript = "I go to the market yesterday.";
  const result = coachResult(rawTranscript, {
    correctedSentence: "I went to the market yesterday.",
    explanationArabic: "لأن الحدث صار أمس، نستخدم went.",
    practiceSentenceEnglish: "I went to the market yesterday.",
    detectedIssues: [{
      type: "grammar",
      evidence: "go ... yesterday",
      explanationArabic: "مع yesterday نستخدم went.",
    }],
    coachReplyArabic: "فكرتك واضحة، بس استخدم went للماضي.",
    coachReplyEnglish: "Use went for the past.",
    expressiveTtsText: "فكرتك واضحة. Use went for the past.",
    shouldTryAgain: true,
  });
  let upstream;
  const handler = createCoachPostHandler({
    environment: async () => GEMINI_ENVIRONMENT,
    fetcher: async (input, init) => {
      upstream = { input: String(input), init };
      return geminiResponse(result);
    },
  });

  const response = await handler(coachRequest(rawTranscript));
  const body = await response.json();
  assert.equal(response.status, 200);
  assert.equal(body.rawTranscript, rawTranscript);
  assert.equal(body.correctedSentence, "I went to the market yesterday.");
  assert.equal(upstream.input, "https://generativelanguage.googleapis.com/v1beta/interactions");
  assert.equal(upstream.init.headers["x-goog-api-key"], GEMINI_ENVIRONMENT.GEMINI_API_KEY);

  const requestBody = JSON.parse(upstream.init.body);
  assert.equal(requestBody.model, "gemini-3.5-flash-lite");
  assert.equal(requestBody.store, false);
  assert.equal(requestBody.generation_config.thinking_level, "minimal");
  assert.equal(requestBody.generation_config.thinking_summaries, "none");
  assert.equal(requestBody.response_format.mime_type, "application/json");
  assert.equal(requestBody.response_format.schema.additionalProperties, false);
  assert.match(requestBody.system_instruction, /untrusted quoted data/);
  assert.equal(JSON.parse(requestBody.input).rawTranscript, rawTranscript);
});

test("Gemini response still passes local vote and raw transcript invariants", async (t) => {
  const rawTranscript = "I would like to vote.";

  await t.test("accepts explicit clarification", async () => {
    const result = coachResult(rawTranscript, {
      probableIntent: "Possibly order coffee, but vote is ambiguous.",
      needsClarification: true,
      confidence: 0.5,
      detectedIssues: [{
        type: "clarification",
        evidence: "vote",
        explanationArabic: "سمعت vote ويمكن قصدك order؛ نحتاج نتأكد.",
      }],
      explanationArabic: "ما نغير المعنى بدون تأكيد.",
      practiceSentenceEnglish: "order",
      coachReplyArabic: "سمعت vote. أعد الكلمة لو قصدك order.",
      coachReplyEnglish: "Please repeat: vote or order?",
      expressiveTtsText: "سمعت vote. Please repeat: vote or order?",
      shouldTryAgain: true,
    });
    const handler = createCoachPostHandler({
      environment: async () => GEMINI_ENVIRONMENT,
      fetcher: async () => geminiResponse(result),
    });
    const response = await handler(coachRequest(rawTranscript));
    const body = await response.json();
    assert.equal(response.status, 200);
    assert.equal(body.cleanedTranscript, rawTranscript);
    assert.equal(body.needsClarification, true);
  });

  await t.test("rejects silent meaning change", async () => {
    const invalidResult = coachResult(rawTranscript, {
      cleanedTranscript: "I would like to order.",
      needsClarification: false,
    });
    const handler = createCoachPostHandler({
      environment: async () => GEMINI_ENVIRONMENT,
      fetcher: async () => geminiResponse(invalidResult),
    });
    const response = await handler(coachRequest(rawTranscript));
    assert.equal(response.status, 502);
  });
});

test("Gemini and provider configuration errors are safe", async (t) => {
  await t.test("missing Gemini key does not fall back to OpenAI", async () => {
    let calls = 0;
    const handler = createCoachPostHandler({
      environment: async () => ({
        COACH_PROVIDER: "gemini",
        OPENAI_API_KEY: "unused-openai-test-key",
      }),
      fetcher: async () => {
        calls += 1;
        return geminiResponse(coachResult(TARGET));
      },
    });
    const response = await handler(coachRequest(TARGET));
    assert.equal(response.status, 503);
    assert.equal(calls, 0);
  });

  await t.test("unknown provider", async () => {
    const handler = createCoachPostHandler({
      environment: async () => ({ COACH_PROVIDER: "unknown" }),
    });
    const response = await handler(coachRequest(TARGET));
    assert.equal(response.status, 503);
  });

  await t.test("provider details and key are not returned", async () => {
    const secret = "never-return-this-gemini-key";
    const handler = createCoachPostHandler({
      environment: async () => ({
        COACH_PROVIDER: "gemini",
        GEMINI_API_KEY: secret,
      }),
      fetcher: async () => Response.json(
        { error: { message: `provider leaked ${secret}` } },
        { status: 401 },
      ),
    });
    const response = await handler(coachRequest(TARGET));
    const text = await response.text();
    assert.equal(response.status, 502);
    assert.equal(text.includes(secret), false);
    assert.deepEqual(JSON.parse(text), {
      code: "provider_failed",
      error: "Coach response generation failed.",
    });
  });
});
