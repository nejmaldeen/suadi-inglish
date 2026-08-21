import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import { createPushToTalkController } from "../lib/speech/recorder.ts";

const pageSource = await readFile(new URL("../app/page.tsx", import.meta.url), "utf8");

function fakeStream() {
  let stopped = false;
  return {
    getTracks: () => [{ stop: () => { stopped = true; } }],
    wasStopped: () => stopped,
  };
}

async function waitForStatus(controller, expectedStatus) {
  for (let attempt = 0; attempt < 20; attempt += 1) {
    if (controller.getState().status === expectedStatus) return;
    await new Promise((resolve) => setTimeout(resolve, 0));
  }
  assert.fail(`Timed out waiting for ${expectedStatus}`);
}

test("session UI uses the push-to-talk controller and only advances from a completed transcript", () => {
  assert.match(pageSource, /createPushToTalkController/);
  assert.match(pageSource, /if \(state\.status === "completed"\)/);
  assert.match(pageSource, /completeListening\(state\.transcript\)/);
  assert.match(pageSource, /if \(!heardText\.trim\(\)\) return/);
  assert.match(pageSource, /setTranscript\(heardText\)/);
  assert.doesNotMatch(pageSource, /setTranscript\([^)]*CORRECTED_SENTENCE/);
  assert.match(pageSource, /<p>\{transcript\}<\/p>/);
});

test("session UI stops recording on the second press and blocks presses while processing", () => {
  assert.match(
    pageSource,
    /if \(status === "listening"\) \{\s*if \(stoppingCapture\.current\) return;\s*stoppingCapture\.current = true;\s*setIsStoppingCapture\(true\);\s*controller\.stop\(\);\s*return;/,
  );
  assert.match(pageSource, /status === "processing"/);
  assert.match(pageSource, /speechInput\.status === "processing"/);
  assert.match(pageSource, /isStoppingCapture \|\|\s*speechInput\.status === "processing"/);
});

test("session UI makes active recording unmistakable and shows elapsed seconds", () => {
  assert.match(pageSource, /جاري التسجيل — اضغط مرة أخرى للإيقاف/);
  assert.match(pageSource, /formatRecordingDuration\(recordingSeconds\)/);
  assert.match(pageSource, /window\.setInterval/);
  assert.match(pageSource, /تم إيقاف التسجيل — جارٍ تجهيز الصوت/);
});

test("session UI releases push-to-talk and contains no browser recognition or claimed transcript fallback", () => {
  assert.match(pageSource, /controller\.dispose\(\)/);
  assert.match(
    pageSource,
    /if \(pushToTalk\.current !== controller\) \{\s*controller\.dispose\(\);\s*return;/,
  );
  assert.doesNotMatch(pageSource, /SpeechRecognition|webkitSpeechRecognition/);
  assert.doesNotMatch(pageSource, /DEMO_TRANSCRIPT|runShowcase/);
});

test("two push-to-talk attempts upload independent audio and preserve each raw transcript", async () => {
  const audioByAttempt = [
    new Blob([new Uint8Array([1, 1])], { type: "audio/webm" }),
    new Blob([new Uint8Array([2, 2, 2])], { type: "audio/webm" }),
  ];
  const transcriptByAttempt = [
    "I went to the market yesterday.",
    "I would like to o-order a flat white, please.",
  ];
  const streams = [];
  const uploadedSizes = [];
  let recorderIndex = 0;
  let responseIndex = 0;

  const controller = createPushToTalkController(() => {}, {
    mediaDevices: {
      async getUserMedia() {
        const stream = fakeStream();
        streams.push(stream);
        return stream;
      },
    },
    chooseMimeType: () => "audio/webm",
    createRecorder: () => {
      const audio = audioByAttempt[recorderIndex];
      recorderIndex += 1;
      return {
        mimeType: audio.type,
        state: "inactive",
        ondataavailable: null,
        onerror: null,
        onstop: null,
        start() { this.state = "recording"; },
        requestData() { this.ondataavailable?.({ data: audio }); },
        stop() {
          this.state = "inactive";
          this.onstop?.();
        },
      };
    },
    fetcher: async (_input, init) => {
      uploadedSizes.push(init.body.size);
      const transcript = transcriptByAttempt[responseIndex];
      responseIndex += 1;
      return Response.json({ text: transcript });
    },
  });

  await controller.start();
  controller.stop();
  await waitForStatus(controller, "completed");
  assert.equal(controller.getState().transcript, transcriptByAttempt[0]);

  controller.reset();
  await controller.start();
  controller.stop();
  await waitForStatus(controller, "completed");

  assert.deepEqual(uploadedSizes, [2, 3]);
  assert.equal(controller.getState().transcript, transcriptByAttempt[1]);
  assert.equal(streams.length, 2);
  assert.ok(streams.every((stream) => stream.wasStopped()));
});
