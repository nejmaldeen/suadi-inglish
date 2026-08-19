import assert from "node:assert/strict";
import test from "node:test";

import { runPlaybackFallback } from "../lib/voice/playback.ts";

test("an API failure advances to the local audio fallback", async () => {
  const calls = [];
  const controller = new AbortController();

  const source = await runPlaybackFallback({
    signal: controller.signal,
    api: async () => {
      calls.push("api");
      throw new Error("provider failed");
    },
    file: async () => {
      calls.push("file");
      return true;
    },
    speech: async () => {
      calls.push("speech");
      return true;
    },
    timer: async () => {
      calls.push("timer");
    },
  });

  assert.equal(source, "file");
  assert.deepEqual(calls, ["api", "file"]);
});
