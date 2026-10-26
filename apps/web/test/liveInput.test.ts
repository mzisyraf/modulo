import assert from "node:assert/strict";
import test from "node:test";
import { audioInputOptions, DEFAULT_AUDIO_INPUT, LiveRequestGate, liveInputErrorMessage } from "../src/liveInput.ts";

test("audio input options exclude outputs and provide stable fallback labels", () => {
  assert.deepEqual(audioInputOptions([
    { deviceId: "one", kind: "audioinput", label: "Scarlett Solo" },
    { deviceId: "speaker", kind: "audiooutput", label: "Headphones" },
    { deviceId: "", kind: "audioinput", label: "" },
  ]), [
    { deviceId: "one", label: "Scarlett Solo" },
    { deviceId: DEFAULT_AUDIO_INPUT, label: "Audio input 1" },
  ]);
});

test("live request gate rejects duplicates and invalidates stale completions", () => {
  const gate = new LiveRequestGate();
  const first = gate.begin();
  assert.equal(typeof first, "number");
  assert.equal(gate.begin(), undefined);
  gate.cancel();
  assert.equal(gate.settle(first!), false);
  const retry = gate.begin();
  assert.equal(gate.settle(retry!), true);
  assert.equal(gate.settle(retry!), false);
  assert.equal(typeof gate.begin(), "number");
});

test("capture errors become useful retry guidance", () => {
  const denied = new Error("Permission denied");
  denied.name = "NotAllowedError";
  assert.match(liveInputErrorMessage(denied), /denied.*try again/i);

  const missing = new Error("Missing");
  missing.name = "NotFoundError";
  assert.match(liveInputErrorMessage(missing), /No audio input.*refresh/i);

  assert.equal(liveInputErrorMessage(new Error("The second channel is unavailable.")), "The second channel is unavailable.");
});
