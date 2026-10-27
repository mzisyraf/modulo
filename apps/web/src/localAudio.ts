export function encodeMonoWav(samples: Float32Array, sampleRate: number): Blob {
  if (!Number.isFinite(sampleRate) || sampleRate <= 0) throw new Error("A valid sample rate is required.");

  const bytesPerSample = 2;
  const dataLength = samples.length * bytesPerSample;
  const buffer = new ArrayBuffer(44 + dataLength);
  const view = new DataView(buffer);

  const writeText = (offset: number, value: string) => {
    for (let index = 0; index < value.length; index++) view.setUint8(offset + index, value.charCodeAt(index));
  };

  writeText(0, "RIFF");
  view.setUint32(4, 36 + dataLength, true);
  writeText(8, "WAVE");
  writeText(12, "fmt ");
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, 1, true);
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * bytesPerSample, true);
  view.setUint16(32, bytesPerSample, true);
  view.setUint16(34, 16, true);
  writeText(36, "data");
  view.setUint32(40, dataLength, true);

  for (let index = 0; index < samples.length; index++) {
    const finite = Number.isFinite(samples[index]) ? samples[index] : 0;
    const clamped = Math.max(-1, Math.min(1, finite));
    view.setInt16(44 + index * bytesPerSample, clamped < 0 ? Math.round(clamped * 32768) : Math.round(clamped * 32767), true);
  }

  return new Blob([buffer], { type: "audio/wav" });
}
