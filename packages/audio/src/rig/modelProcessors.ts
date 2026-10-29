import type { Values } from "./catalog.ts";

/** Original native processors. A future worklet/WASM adapter must implement equivalent lifecycle/binding guarantees. */
interface ProcessorTools {
  context: BaseAudioContext; input: AudioNode; output: AudioNode;
  gain: (value?: number) => GainNode;
  filter: (type: BiquadFilterType, frequency: number) => BiquadFilterNode;
  own: <T extends AudioNode>(node: T) => T;
  bind: (parameter: AudioParam, value: (values: Values) => number) => void;
}
type ProcessorFactory = (tools: ProcessorTools) => void;
const factories: Record<string, ProcessorFactory> = {
  "native.studio-clean.v1": ({ input, output, gain, filter, bind }) => {
    const highpass = filter("highpass", 35), low = filter("lowshelf", 180), high = filter("highshelf", 2800), volume = gain();
    input.connect(highpass).connect(low).connect(high).connect(volume).connect(output);
    bind(low.gain, p => Number(p.bass_db)); bind(high.gain, p => Number(p.treble_db) + (p.bright ? 3 : 0));
    bind(volume.gain, p => 10 ** (Number(p.master_db) / 20));
  },
  "native.single-tap.v1": ({ context, input, output, gain, own, bind }) => {
    const delay = own(context.createDelay(2.1)), dry = gain(), wet = gain();
    input.connect(dry).connect(output); input.connect(delay).connect(wet).connect(output);
    bind(delay.delayTime, p => Number(p.time_ms) / 1000); bind(dry.gain, p => 1 - Number(p.mix)); bind(wet.gain, p => Number(p.mix));
  },
  "native.tilt-eq.v1": ({ input, output, filter, bind, context }) => {
    const low = filter("lowshelf", 800), high = filter("highshelf", 800); input.connect(low).connect(high).connect(output);
    // Legacy bass_db/mid_hz are compatibility slots for the model's tilt and pivot.
    bind(low.gain, p => -Number(p.bass_db)); bind(high.gain, p => Number(p.bass_db));
    bind(low.frequency, p => Math.min(Number(p.mid_hz), context.sampleRate * 0.45)); bind(high.frequency, p => Math.min(Number(p.mid_hz), context.sampleRate * 0.45));
  },
};
export function buildModelProcessor(id: string, tools: ProcessorTools): boolean {
  if (id.startsWith("legacy.")) return false;
  const factory = factories[id]; if (!factory) throw new Error(`Processor factory is unavailable: ${id}`);
  factory(tools); return true;
}
export const NATIVE_MODEL_FACTORIES = Object.freeze(Object.keys(factories));
