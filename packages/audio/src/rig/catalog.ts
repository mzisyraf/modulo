export type Value = number | boolean | string;
export type Values = Record<string, Value>;
export interface Control {
  kind: "number" | "boolean" | "choice";
  defaultValue: Value;
  min?: number; max?: number; unit?: string; choices?: string[];
  /** Buffer/model changes must be applied as a rig, not scheduled as an AudioParam. */
  realtime: boolean;
}
export interface RigModel {
  id: string; name: string; character: string;
  reference?: string; source?: string;
  /** All models here are algorithmic approximations, never verified circuit captures. */
  coefficients: Record<string, number>;
  /** Initial wire values for newer processors; old model defaults remain unchanged. */
  defaults?: Values;
}
export interface ModuleDefinition {
  name: string; position: "input" | "pre" | "amp" | "cab" | "post" | "output";
  controls: Record<string, Control>; models: RigModel[];
}
const n = (value: number, min: number, max: number, unit = "", realtime = true): Control => ({ kind: "number", defaultValue: value, min, max, unit, realtime });
const b = (value = false): Control => ({ kind: "boolean", defaultValue: value, realtime: true });
const c = (value: string, choices: string[]): Control => ({ kind: "choice", defaultValue: value, choices, realtime: false });
const model = (id: string, name: string, character: string, coefficients: Record<string, number> = {}, reference?: string, source?: string): RigModel => ({ id, name, character, coefficients, reference, source });
const mix = n(0.3, 0, 1);
const level = n(0, -24, 12, "dB");
const rate = n(1, 0.05, 12, "Hz");
const time = n(350, 10, 2000, "ms");
const gainControls = { drive: n(0.25, 0, 1), tone: n(0.5, 0, 1), level_db: level, mix: n(1, 0, 1) };

export const RIG_CATALOG = {
  input: { name: "Input", position: "input", controls: { trim_db: n(0, -36, 12, "dB"), mute: b(), invert: b() }, models: [model("interface", "Interface input", "Selected mono interface channel; hardware Hi-Z/pad remains a physical setting")] },
  gate: { name: "Noise gate", position: "pre", controls: { threshold_db: n(-55, -90, -10, "dBFS"), attack_ms: n(3, 0.1, 50, "ms"), hold_ms: n(50, 0, 500, "ms"), release_ms: n(150, 10, 1000, "ms"), depth_db: n(-60, -90, 0, "dB"), hysteresis_db: n(6, 0, 18, "dB") }, models: [model("gentle", "Gentle gate", "Smooth note tails", { detector: 0.02 }), model("tight", "Tight gate", "Faster envelope tracking", { detector: 0.005 }), model("soft", "Soft expander", "Progressive attenuation below threshold", { detector: 0.02, expand: 1 })] },
  compressor: { name: "Compressor", position: "pre", controls: { threshold_db: n(-24, -60, 0, "dBFS"), ratio: n(4, 1, 20), attack_ms: n(10, 0, 100, "ms"), release_ms: n(150, 10, 1000, "ms"), knee_db: n(12, 0, 40, "dB"), makeup_db: n(0, 0, 12, "dB"), mix: n(1, 0, 1) }, models: [model("studio", "Studio compressor", "Neutral native dynamics", { knee: 0 }), model("sustain", "Pedal sustain", "Softer knee and fuller body", { knee: 8 }), model("punch", "Punch compressor", "Harder knee with transient emphasis", { knee: -8 })] },
  boost: { name: "Boost", position: "pre", controls: { gain_db: n(3, 0, 18, "dB"), tone: n(0.5, 0, 1) }, models: [model("clean", "Clean boost", "Broadband level", { highpass: 20, tilt: 0 }), model("treble", "Treble boost", "Reduced bass and raised upper mids", { highpass: 450, tilt: 4 }), model("mid", "Mid boost", "Midrange emphasis", { highpass: 100, tilt: 2 })] },
  wah: { name: "Wah", position: "pre", controls: { position: n(0.5, 0, 1), q: n(5, 0.5, 12), mix: n(1, 0, 1), level_db: level }, models: [model("classic", "Classic wah", "Traditional mid sweep", { low: 350, high: 2200 }), model("wide", "Wide wah", "Extended sweep", { low: 180, high: 3500 }), model("vocal", "Vocal wah", "Narrow vocal-range sweep", { low: 500, high: 1800 })] },
  overdrive: { name: "Overdrive", position: "pre", controls: gainControls, models: [
    model("green", "TS808-inspired Green OD", "Mid-forward soft-clipping character; approximate", { shape: 0, pre: 3, highpass: 180, mid: 4, cutoff: 5500 }, "Ibanez TS808", "https://www.ibanez.com/eu/products/detail/ts808_99.html"),
    model("gold", "BOSS SD-1-inspired Yellow OD", "Asymmetric mid-forward saturation; approximate", { shape: 3, pre: 4, highpass: 120, mid: 2, cutoff: 6800 }, "BOSS SD-1", "https://support.roland.com/hc/en-us/articles/201952119-SD-1-Specifications"),
    model("blue", "BOSS BD-2-inspired Blue OD", "Bright open clipping character; approximate", { shape: 1, pre: 4, highpass: 90, mid: 1, cutoff: 6500 }, "BOSS BD-2", "https://static.roland.com/assets/media/pdf/BD-2_M_eng02_W.pdf"),
  ] },
  distortion: { name: "Distortion", position: "pre", controls: gainControls, models: [
    model("orange", "DS-1-inspired Orange Distortion", "Scooped hard-clip character; approximate", { shape: 2, pre: 10, highpass: 100, mid: -4, cutoff: 6500 }, "BOSS DS-1", "https://www.boss.info/global/products/ds-1/"),
    model("rodent", "Pro Co RAT2-inspired Rodent", "Rounded high-gain clipping and darker filter; approximate", { shape: 1, pre: 16, highpass: 70, mid: 2, cutoff: 4500 }, "Pro Co RAT2", "https://actentertainment.com/rat-2-distortion-pedal/"),
    model("gold", "MXR Distortion+-inspired Gold", "Bright soft clipping; approximate", { shape: 0, pre: 8, highpass: 120, mid: 0, cutoff: 7500 }, "MXR Distortion+", "https://www.jimdunlop.com/mxr-distortion/"),
  ] },
  fuzz: { name: "Fuzz", position: "pre", controls: { ...gainControls, bias: n(0, -0.4, 0.4) }, models: [model("round", "Round vintage fuzz", "Rounded asymmetric breakup", { shape: 3, pre: 22, highpass: 45, mid: 1, cutoff: 4800 }), model("sustain", "Sustain fuzz", "Dense clipped sustain and scooped mids", { shape: 2, pre: 30, highpass: 70, mid: -5, cutoff: 4000 }), model("velcro", "Velcro fuzz", "Sharper asymmetric clipping", { shape: 3, pre: 40, highpass: 160, mid: 3, cutoff: 6000 })] },
  amp: { name: "Amplifier", position: "amp", controls: { gain: n(0.35, 0, 1), bass_db: n(0, -12, 12, "dB"), mid_db: n(0, -12, 12, "dB"), treble_db: n(0, -12, 12, "dB"), presence_db: n(0, -6, 6, "dB"), resonance_db: n(0, -6, 6, "dB"), master_db: n(-6, -24, 0, "dB"), bright: b() }, models: [model("american_clean", "American Clean", "High-headroom clean amp character", { pre: 1.8, highpass: 45, mid: -2, cutoff: 11000, shape: 0 }), model("british_crunch", "British Crunch", "Mid-forward crunch amp character", { pre: 7, highpass: 90, mid: 3, cutoff: 8500, shape: 1 }), model("modern_high_gain", "Modern High Gain", "Tighter bass and cascaded high-gain character", { pre: 20, highpass: 150, mid: -2, cutoff: 7500, shape: 0 }), model("studio_clean", "Studio Clean Preamp", "Original linear preamp and two-band EQ; no amp/hardware emulation") ] },
  cabinet: { name: "Cabinet IR and microphones", position: "cab", controls: { low_cut_hz: n(70, 20, 500, "Hz"), high_cut_hz: n(6500, 1000, 16000, "Hz"), position: n(0.4, 0, 1, "", false), distance: n(0.1, 0, 1, "", false), mic: c("dynamic", ["dynamic", "ribbon", "condenser"]), mic2: c("ribbon", ["dynamic", "ribbon", "condenser"]), mic2_position: n(0.7, 0, 1, "", false), mic2_distance: n(0.2, 0, 1, "", false), mic_blend: n(0, 0, 1), mic2_delay_ms: n(0, 0, 10, "ms"), mic2_invert: b(), mix: n(1, 0, 1), level_db: level, ir_id: c("none", ["none"]) }, models: [model("open_112", "Open 1×12 / synthetic IR", "Open-backed, lighter bass", { resonance: 125, brightness: 5800, decay: 0.025 }), model("british_212", "British 2×12 / synthetic IR", "Balanced mid-forward cabinet", { resonance: 100, brightness: 4800, decay: 0.045 }), model("closed_412", "Closed 4×12 / synthetic IR", "Deeper closed-cabinet resonance", { resonance: 85, brightness: 4000, decay: 0.06 }), model("custom", "User cabinet IR", "Bounded user-supplied IR; no asset embedded in preset") ] },
  eq: { name: "Parametric EQ", position: "post", controls: { low_cut_hz: n(25, 20, 500, "Hz"), bass_db: n(0, -12, 12, "dB"), mid_hz: n(1000, 100, 6000, "Hz"), mid_q: n(0.8, 0.2, 10), mid_db: n(0, -18, 18, "dB"), treble_db: n(0, -12, 12, "dB"), high_cut_hz: n(16000, 1000, 20000, "Hz") }, models: [model("neutral", "Neutral EQ", "Transparent shelving and one parametric band"), model("warm", "Warm EQ", "Lower shelf pivot", { shelf: 180 }), model("bright", "Bright EQ", "Higher shelf pivot", { shelf: 350 }), { ...model("tilt", "Tilt EQ", "Original complementary low/high shelves with movable pivot"), defaults: { mid_hz: 800 } }] },
  chorus: { name: "Chorus", position: "post", controls: { rate_hz: rate, depth_ms: n(3, 0, 8, "ms"), delay_ms: n(18, 10, 35, "ms"), mix }, models: [model("classic", "Classic chorus", "Single modulated voice", { phase: 0, filter: 9000 }), model("wide", "Wide chorus", "Stereo spread", { phase: 1, filter: 11000 }), model("dark", "Dark chorus", "Damped modulation", { phase: 1, filter: 4500 })] },
  flanger: { name: "Flanger", position: "post", controls: { rate_hz: rate, depth_ms: n(1.5, 0, 3, "ms"), delay_ms: n(3, 3, 12, "ms"), feedback: n(0.3, -0.75, 0.75), mix: n(0.5, 0, 1) }, models: [model("positive", "Positive flange", "Positive-polarity comb sweep", { polarity: 1 }), model("negative", "Negative flange", "Inverted wet comb sweep", { polarity: -1 }), model("wide", "Wide flange", "Stereo comb motion", { polarity: 1, stereo: 1 })] },
  phaser: { name: "Phaser", position: "post", controls: { rate_hz: rate, depth: n(0.6, 0, 1), center_hz: n(800, 200, 2500, "Hz"), mix: n(0.5, 0, 1) }, models: [model("four", "Four-stage phase", "Gentle notches", { stages: 4 }), model("six", "Six-stage phase", "Deeper sweep", { stages: 6 }), model("eight", "Eight-stage phase", "Dense notches", { stages: 8 })] },
  tremolo: { name: "Tremolo", position: "post", controls: { rate_hz: n(4, 0.1, 20, "Hz"), depth: n(0.5, 0, 1), mix: n(1, 0, 1) }, models: [model("sine", "Sine tremolo", "Smooth amplitude motion", { wave: 0 }), model("triangle", "Triangle tremolo", "Linear amplitude motion", { wave: 1 }), model("square", "Chop tremolo", "Square amplitude motion", { wave: 2 })] },
  pitch: { name: "Pitch shifter", position: "pre", controls: { semitones: n(0, -12, 12, "semitones"), cents: n(0, -50, 50, "cents"), mix: n(1, 0, 1) }, models: [model("fast", "Fast pitch", "Short crossfaded delay grains; artifacts possible", { window_ms: 30 }), model("smooth", "Smooth pitch", "Longer grains; more processing delay", { window_ms: 60 }), model("detune", "Wide detune", "Stereo opposing detune", { window_ms: 45, stereo: 1 })] },
  delay: { name: "Delay", position: "post", controls: { time_ms: time, feedback: n(0.25, 0, 0.8), mix, tone_hz: n(6000, 600, 12000, "Hz"), sync: b(), division: c("quarter", ["quarter", "eighth", "dotted_eighth", "triplet"]) }, models: [model("digital", "Digital delay", "Clear filtered repeats", { dark: 1 }), model("analog", "Analog-style delay", "Darker repeats", { dark: 0.5 }), model("ping_pong", "Ping-pong delay", "Alternating stereo repeats", { dark: 1, pingpong: 1 }), { ...model("single_tap", "Single Tap / Slapback", "Original feed-forward delay: one echo, no feedback loop or tempo sync"), defaults: { time_ms: 120, feedback: 0 } }] },
  reverb: { name: "Reverb", position: "post", controls: { decay_s: n(1.5, 0.2, 6, "s", false), predelay_ms: n(20, 0, 250, "ms"), damping_hz: n(5000, 500, 12000, "Hz"), mix: n(0.2, 0, 1) }, models: [model("room", "Room / synthetic IR", "Short dense reflections", { density: 0.7 }), model("plate", "Plate-style / synthetic IR", "Dense smooth tail", { density: 1 }), model("spring", "Spring-style / synthetic IR", "Dispersive chirped tail; no physical spring model", { density: 0.3 })] },
  output: { name: "Output and limiter", position: "output", controls: { level_db: n(-18, -48, -3, "dB"), mute: b(), pan: n(0, -1, 1), width: n(1, 0, 1), limiter_db: n(-3, -12, -1, "dBFS"), limiter_release_ms: n(100, 20, 500, "ms") }, models: [model("protected", "Protected output", "Stereo control, dynamics limiter and final sample bound")] },
} satisfies Record<string, ModuleDefinition>;

export type ModuleType = keyof typeof RIG_CATALOG;
export const RIG_MODULE_TYPES = Object.keys(RIG_CATALOG) as ModuleType[];
function freezeCatalog(value: object): void {
  for (const child of Object.values(value)) if (child && typeof child === "object" && !Object.isFrozen(child)) freezeCatalog(child);
  Object.freeze(value);
}
freezeCatalog(RIG_CATALOG);
Object.freeze(RIG_MODULE_TYPES);
export function moduleDefinition(type: ModuleType): ModuleDefinition { return RIG_CATALOG[type]; }
export function getRigCatalog(): Record<ModuleType, ModuleDefinition> { return structuredClone(RIG_CATALOG); }
