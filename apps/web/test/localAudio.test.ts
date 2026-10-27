import assert from "node:assert/strict";
import test from "node:test";
import { encodeMonoWav } from "../src/localAudio.ts";

test("mono calibration samples become a valid bounded PCM16 WAV", async () => {
  const blob = encodeMonoWav(new Float32Array([-2, -0.5, 0, 0.5, 2, Number.NaN]), 48_000);
  const view = new DataView(await blob.arrayBuffer());
  const text = (offset: number, length: number) => String.fromCharCode(...new Uint8Array(view.buffer, offset, length));

  assert.equal(blob.type, "audio/wav");
  assert.equal(text(0, 4), "RIFF");
  assert.equal(text(8, 4), "WAVE");
  assert.equal(text(36, 4), "data");
  assert.equal(view.getUint16(22, true), 1);
  assert.equal(view.getUint32(24, true), 48_000);
  assert.equal(view.getUint16(34, true), 16);
  assert.equal(view.getUint32(40, true), 12);
  assert.deepEqual(Array.from({ length: 6 }, (_, index) => view.getInt16(44 + index * 2, true)), [-32768, -16384, 0, 16384, 32767, 0]);
});

test("WAV encoding rejects invalid sample rates", () => {
  assert.throws(() => encodeMonoWav(new Float32Array(), 0), /valid sample rate/i);
});
