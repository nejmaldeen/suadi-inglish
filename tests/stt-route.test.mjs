import assert from "node:assert/strict";
import test from "node:test";

import { createSttPostHandler } from "../app/api/stt/route.ts";
import { MAX_SPEECH_FILE_BYTES } from "../lib/speech/contracts.ts";

const environment = async () => ({ ELEVENLABS_API_KEY: "server-test-key" });

function requestWith(value) {
  if (value === undefined) {
    return new Request("http://localhost/api/stt", { method: "POST" });
  }
  return new Request("http://localhost/api/stt", {
    method: "POST",
    headers: {
      "Content-Type": value.type,
      "X-Audio-Filename": value.name,
    },
    body: value,
  });
}

test("POST /api/stt sends valid audio to ElevenLabs Scribe v2", async () => {
  let upstreamRequest;
  const handler = createSttPostHandler({
    environment,
    fetcher: async (input, init) => {
      upstreamRequest = { input: String(input), init };
      return Response.json({ text: "I went to the market yesterday.", language_code: "en" });
    },
  });

  const audio = new File([new Uint8Array([26, 69, 223, 163])], "speech.webm", {
    type: "audio/webm",
  });
  const response = await handler(requestWith(audio));

  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), {
    text: "I went to the market yesterday.",
    languageCode: "en",
  });
  assert.equal(upstreamRequest.input, "https://api.elevenlabs.io/v1/speech-to-text");
  assert.equal(upstreamRequest.init.headers["xi-api-key"], "server-test-key");
  assert.equal(upstreamRequest.init.body.get("model_id"), "scribe_v2");
  assert.equal(upstreamRequest.init.body.get("tag_audio_events"), "false");
  assert.equal(upstreamRequest.init.body.has("language_code"), false);
  assert.equal(upstreamRequest.init.body.get("file").name, "speech.webm");
});

test("POST /api/stt rejects a request without an audio file", async () => {
  let upstreamCalls = 0;
  const handler = createSttPostHandler({
    environment,
    fetcher: async () => {
      upstreamCalls += 1;
      return Response.json({ text: "unexpected" });
    },
  });

  const response = await handler(requestWith());
  assert.equal(response.status, 400);
  assert.deepEqual(await response.json(), {
    code: "missing_audio",
    error: "An audio file is required.",
  });
  assert.equal(upstreamCalls, 0);
});

test("POST /api/stt rejects unsupported and unreasonably large files", async (t) => {
  const handler = createSttPostHandler({ environment });

  await t.test("unsupported type", async () => {
    const response = await handler(
      requestWith(new File(["not audio"], "speech.txt", { type: "text/plain" })),
    );
    assert.equal(response.status, 415);
    assert.equal((await response.json()).code, "invalid_audio");
  });

  await t.test("oversized audio", async () => {
    const response = await handler(
      requestWith(
        new File([new Uint8Array(MAX_SPEECH_FILE_BYTES + 1)], "speech.webm", {
          type: "audio/webm",
        }),
      ),
    );
    assert.equal(response.status, 413);
    assert.equal((await response.json()).code, "audio_too_large");
  });
});

test("POST /api/stt returns a safe error when ElevenLabs fails", async () => {
  const secret = "never-return-this-key";
  const handler = createSttPostHandler({
    environment: async () => ({ ELEVENLABS_API_KEY: secret }),
    fetcher: async () => Response.json({ detail: `provider leaked ${secret}` }, { status: 401 }),
  });
  const response = await handler(
    requestWith(new File([new Uint8Array([1, 2, 3])], "speech.webm", { type: "audio/webm" })),
  );
  const body = await response.text();

  assert.equal(response.status, 502);
  assert.equal(body.includes(secret), false);
  assert.deepEqual(JSON.parse(body), {
    code: "provider_failed",
    error: "Speech transcription failed.",
  });
});

test("POST /api/stt treats an empty transcript as no speech", async () => {
  const handler = createSttPostHandler({
    environment,
    fetcher: async () => Response.json({ text: "   ", language_code: "en" }),
  });
  const response = await handler(
    requestWith(new File([new Uint8Array([1])], "silence.webm", { type: "audio/webm" })),
  );

  assert.equal(response.status, 422);
  assert.equal((await response.json()).code, "no_speech");
});
