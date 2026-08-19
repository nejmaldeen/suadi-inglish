import assert from "node:assert/strict";
import test from "node:test";

import { createTtsPostHandler } from "../app/api/tts/route.ts";

function request(handler, scriptId) {
  return handler(
    new Request("http://localhost/api/tts", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ scriptId }),
    }),
  );
}

test("POST /api/tts validates, generates, and caches coffee-v1", async (t) => {
  let upstreamCalls = 0;
  let environment = {};
  const handler = createTtsPostHandler({
    cache: new Map(),
    environment: async () => environment,
    fetcher: async () => {
    upstreamCalls += 1;
    return new Response(new Uint8Array([73, 68, 51]), {
      status: 200,
      headers: { "Content-Type": "audio/mpeg" },
    });
    },
  });

  await t.test("rejects an unknown script before contacting ElevenLabs", async () => {
    environment = {
      ELEVENLABS_API_KEY: "test-key",
      ELEVENLABS_VOICE_ID: "test-voice",
      ELEVENLABS_MODEL_ID: "test-model",
    };
    const response = await request(handler, "unknown-script");
    assert.equal(response.status, 400);
    assert.equal(upstreamCalls, 0);
  });

  await t.test("returns a safe 503 when environment variables are missing", async () => {
    environment = {};
    const response = await request(handler, "coffee-v1");
    assert.equal(response.status, 503);
    assert.deepEqual(await response.json(), { error: "Voice service is unavailable." });
    assert.equal(upstreamCalls, 0);
  });

  await t.test("returns audio/mpeg and reuses the in-memory cache", async () => {
    environment = {
      ELEVENLABS_API_KEY: "test-key",
      ELEVENLABS_VOICE_ID: "test-voice",
      ELEVENLABS_MODEL_ID: "test-model",
    };

    const first = await request(handler, "coffee-v1");
    assert.equal(first.status, 200);
    assert.match(first.headers.get("content-type") ?? "", /^audio\/mpeg\b/i);
    assert.deepEqual(new Uint8Array(await first.arrayBuffer()), new Uint8Array([73, 68, 51]));

    const second = await request(handler, "coffee-v1");
    assert.equal(second.status, 200);
    assert.equal(upstreamCalls, 1);
  });
});
