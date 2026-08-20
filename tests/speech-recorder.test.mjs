import assert from "node:assert/strict";
import test from "node:test";

import { createPushToTalkController } from "../lib/speech/recorder.ts";

function fakeStream() {
  let stopped = false;
  return {
    getTracks: () => [{ stop: () => { stopped = true; } }],
    wasStopped: () => stopped,
  };
}

function recorderFactory(audio) {
  return {
    create() {
      return {
        mimeType: audio.type,
        state: "inactive",
        ondataavailable: null,
        onerror: null,
        onstop: null,
        start() { this.state = "recording"; },
        requestData() { this.ondataavailable?.({ data: audio }); },
        stop() { this.state = "inactive"; this.onstop?.(); },
      };
    },
  };
}

test("push-to-talk records only after start and returns the real transcript", async () => {
  const states = [];
  const stream = fakeStream();
  const factory = recorderFactory(new Blob([new Uint8Array([1, 2, 3])], { type: "audio/webm" }));
  let mediaRequests = 0;
  let uploadedAudio;
  const controller = createPushToTalkController((state) => states.push(state), {
    mediaDevices: {
      async getUserMedia() {
        mediaRequests += 1;
        return stream;
      },
    },
    createRecorder: () => factory.create(),
    chooseMimeType: () => "audio/webm",
    fetcher: async (_input, init) => {
      uploadedAudio = init.body;
      return Response.json({ text: "جربت جملة مختلفة" });
    },
  });

  assert.equal(mediaRequests, 0);
  await controller.start();
  assert.equal(mediaRequests, 1);
  assert.equal(controller.getState().status, "listening");
  controller.stop();
  await new Promise((resolve) => setTimeout(resolve, 0));

  assert.deepEqual(states.map((state) => state.status), ["listening", "processing", "completed"]);
  assert.equal(controller.getState().transcript, "جربت جملة مختلفة");
  assert.equal(uploadedAudio.type, "audio/webm");
  assert.equal(stream.wasStopped(), true);
});

test("push-to-talk exposes microphone permission rejection", async () => {
  const controller = createPushToTalkController(() => {}, {
    mediaDevices: {
      async getUserMedia() {
        throw new DOMException("denied", "NotAllowedError");
      },
    },
    createRecorder: () => { throw new Error("must not create recorder"); },
  });

  await controller.start();
  assert.deepEqual(controller.getState(), {
    status: "error",
    transcript: "",
    errorCode: "microphone_permission",
  });
});

test("push-to-talk reports an empty recording without a network request", async () => {
  const factory = recorderFactory(new Blob([], { type: "audio/webm" }));
  let requests = 0;
  const controller = createPushToTalkController(() => {}, {
    mediaDevices: { getUserMedia: async () => fakeStream() },
    createRecorder: () => factory.create(),
    chooseMimeType: () => "audio/webm",
    fetcher: async () => {
      requests += 1;
      return Response.json({ text: "unexpected" });
    },
  });

  await controller.start();
  controller.stop();
  await new Promise((resolve) => setTimeout(resolve, 0));

  assert.equal(controller.getState().errorCode, "no_audio");
  assert.equal(requests, 0);
});

test("push-to-talk exposes an interrupted connection safely", async () => {
  const factory = recorderFactory(new Blob([new Uint8Array([1])], { type: "audio/webm" }));
  const controller = createPushToTalkController(() => {}, {
    mediaDevices: { getUserMedia: async () => fakeStream() },
    createRecorder: () => factory.create(),
    chooseMimeType: () => "audio/webm",
    fetcher: async () => {
      throw new TypeError("connection interrupted");
    },
  });

  await controller.start();
  controller.stop();
  await new Promise((resolve) => setTimeout(resolve, 0));

  assert.deepEqual(controller.getState(), {
    status: "error",
    transcript: "",
    errorCode: "network_failed",
  });
});
