export interface PassageBounds {
  start: number;
  end: number;
}

export const MIN_PASSAGE_SECONDS = 3;

export function demoPassageBounds(duration: number): PassageBounds {
  if (!Number.isFinite(duration) || duration <= 0) return { start: 0, end: 0 };
  if (duration <= 15) return { start: 0, end: duration };

  const start = Math.min(42, duration - 15);
  return { start, end: Math.min(duration, start + 15) };
}

export function formatAudioTime(seconds: number): string {
  const safeSeconds = Math.max(0, Number.isFinite(seconds) ? seconds : 0);
  const minutes = Math.floor(safeSeconds / 60);
  return `${minutes}:${Math.floor(safeSeconds % 60).toString().padStart(2, "0")}`;
}

export function waveformBars(channels: readonly Float32Array[], barCount = 84): number[] {
  if (barCount <= 0 || channels.length === 0 || channels.every((channel) => channel.length === 0)) return [];

  const sampleCount = Math.max(...channels.map((channel) => channel.length));
  const bars = Array.from({ length: Math.min(barCount, sampleCount) }, (_, barIndex) => {
    const start = Math.floor((barIndex / barCount) * sampleCount);
    const end = Math.max(start + 1, Math.floor(((barIndex + 1) / barCount) * sampleCount));
    let squaredTotal = 0;
    let measuredSamples = 0;

    for (const channel of channels) {
      for (let sampleIndex = start; sampleIndex < Math.min(end, channel.length); sampleIndex++) {
        const sample = channel[sampleIndex] ?? 0;
        squaredTotal += sample * sample;
        measuredSamples++;
      }
    }
    return measuredSamples ? Math.sqrt(squaredTotal / measuredSamples) : 0;
  });

  const maximum = Math.max(...bars, 0.001);
  return bars.map((bar) => Math.max(0.08, bar / maximum));
}

export function passageWaveformBars(bars: readonly number[], duration: number, passage: PassageBounds): number[] {
  if (!bars.length || duration <= 0 || passage.end <= passage.start) return [];
  const startIndex = Math.max(0, Math.floor((passage.start / duration) * bars.length));
  const endIndex = Math.min(bars.length, Math.max(startIndex + 1, Math.ceil((passage.end / duration) * bars.length)));
  return bars.slice(startIndex, endIndex);
}

export function resizePassage(
  passage: PassageBounds,
  edge: "start" | "end",
  time: number,
  duration: number,
  minimum = MIN_PASSAGE_SECONDS,
): PassageBounds {
  if (edge === "start") {
    return { start: Math.max(0, Math.min(time, passage.end - minimum)), end: passage.end };
  }
  return { start: passage.start, end: Math.min(duration, Math.max(time, passage.start + minimum)) };
}

export function movePassage(passage: PassageBounds, delta: number, duration: number): PassageBounds {
  const length = passage.end - passage.start;
  const start = Math.max(0, Math.min(passage.start + delta, Math.max(0, duration - length)));
  return { start, end: Math.min(duration, start + length) };
}
