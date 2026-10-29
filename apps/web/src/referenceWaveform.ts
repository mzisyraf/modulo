export interface PassageBounds {
  start: number;
  end: number;
}

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
    let peak = 0;

    for (const channel of channels) {
      for (let sampleIndex = start; sampleIndex < Math.min(end, channel.length); sampleIndex++) {
        peak = Math.max(peak, Math.abs(channel[sampleIndex] ?? 0));
      }
    }
    return peak;
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
