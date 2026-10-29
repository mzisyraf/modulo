import { moduleDefinition, RIG_MODULE_TYPES, type ModuleType, type Value, type Values } from "./catalog.ts";
import { allRigModules, createRigModule, parseRigPreset, validateControl, type RigModule, type RigPreset } from "./preset.ts";

export const GEAR_CATEGORIES = {
  amplifiers: "Amplifiers", cabinets: "Cabinets", overdrive: "Overdrive", distortion: "Distortion", fuzz: "Fuzz",
  compressor: "Compressor", gate: "Noise gate", wah: "Wah", modulation: "Modulation", delay: "Delay", reverb: "Reverb", eq: "EQ", pitch: "Pitch", utility: "Utility",
} as const;
export type GearCategory = keyof typeof GEAR_CATEGORIES;
export interface ModelParameter {
  id: string; label: string; type: "number" | "boolean" | "choice" | "asset";
  widget: "knob" | "slider" | "switch" | "toggle" | "dropdown" | "asset";
  min?: number; max?: number; defaultValue: Value; unit: string; step?: number;
  scaling: { type: "linear" | "log" | "power"; exponent?: number };
  choices: { value: string; label: string }[];
  binding: { target: string; scale: number; offset: number };
  realtime: boolean; visibleWhen?: { parameter: string; equals: Value };
  help?: string;
}
export interface GearModel {
  id: string; version: 1; name: string; category: GearCategory; description: string;
  type: ModuleType; model: string; parameters: ModelParameter[];
  dsp: { factory: string; backend: "native" | "audio-worklet"; approximation: string };
  reference?: string; source?: string;
}
const n = (id: string, label: string, target: string, min: number, max: number, value: number, unit = "", curve: "linear" | "log" | "power" = "linear", scale = 1, offset = 0): ModelParameter => ({ id, label, type: "number", widget: "knob", min, max, defaultValue: value, unit, scaling: { type: curve, ...(curve === "power" ? { exponent: 2 } : {}) }, choices: [], binding: { target, scale, offset }, realtime: true });
const toggle = (id: string, label: string, target = id, widget: "toggle" | "switch" = "toggle"): ModelParameter => ({ id, label, type: "boolean", widget, defaultValue: false, unit: "", scaling: { type: "linear" }, choices: [], binding: { target, scale: 1, offset: 0 }, realtime: true });
const choice = (id: string, label: string, values: string[], value: string, target = id): ModelParameter => ({ id, label, type: "choice", widget: "dropdown", defaultValue: value, unit: "", scaling: { type: "linear" }, choices: values.map(value => ({ value, label: value.replaceAll("_", " ") })), binding: { target, scale: 1, offset: 0 }, realtime: false });
const drive = (label = "Drive") => n("drive", label, "drive", 0, 1, 0.25, "", "power");
const tone = () => n("tone", "Tone", "tone", 0, 1, 0.5);
const level = (label = "Level") => n("level_db", label, "level_db", -24, 12, 0, "dB");
const mix = (value = 0.3) => n("mix", "Mix", "mix", 0, 1, value);
const bass = () => n("bass_db", "Bass", "bass_db", -12, 12, 0, "dB");
const mid = () => n("mid_db", "Middle", "mid_db", -12, 12, 0, "dB");
const treble = () => n("treble_db", "Treble", "treble_db", -12, 12, 0, "dB");
const ampGain = () => n("gain", "Gain", "gain", 0, 1, 0.35, "", "power");
const master = () => n("master_db", "Master", "master_db", -24, 0, -6, "dB");
const presence = () => n("presence_db", "Presence", "presence_db", -6, 6, 0, "dB");
const threshold = (value = -55) => n("threshold_db", "Threshold", "threshold_db", -90, -10, value, "dBFS");
const release = () => n("release_ms", "Release", "release_ms", 10, 1000, 150, "ms", "log");
const rate = () => n("rate_hz", "Rate", "rate_hz", 0.05, 12, 1, "Hz", "log");
const frequency = (id: string, label: string, min: number, max: number, value: number) => n(id, label, id, min, max, value, "Hz", "log");
const time = (value = 350) => n("time_ms", "Time", "time_ms", 10, 2000, value, "ms", "log");
const feedback = () => n("feedback", "Feedback", "feedback", 0, 0.8, 0.25);
const sync = () => toggle("sync", "Tempo sync", "sync", "switch");
const division = () => ({ ...choice("division", "Note division", ["quarter", "eighth", "dotted_eighth", "triplet"], "quarter"), visibleWhen: { parameter: "sync", equals: true } });
const timed = () => ({ ...time(), visibleWhen: { parameter: "sync", equals: false } });
const decay = () => ({ ...n("decay_s", "Decay", "decay_s", 0.2, 6, 1.5, "s", "log"), realtime: false });
const predelay = () => n("predelay_ms", "Pre-delay", "predelay_ms", 0, 250, 20, "ms");
const damping = () => frequency("damping_hz", "Damping", 500, 12000, 5000);
const categoryFor = (type: ModuleType): GearCategory => type === "amp" ? "amplifiers" : type === "cabinet" ? "cabinets" : ["chorus", "flanger", "phaser", "tremolo"].includes(type) ? "modulation" : ["input", "output", "boost"].includes(type) ? "utility" : type as GearCategory;
const registry = new Map<string, GearModel>();
function define(type: ModuleType, model: string, parameters: ModelParameter[], factory = `legacy.${type}.${model}`): void {
  const info = moduleDefinition(type).models.find(item => item.id === model)!;
  for (const parameter of parameters) parameter.realtime = moduleDefinition(type).controls[parameter.binding.target].realtime;
  const definition: GearModel = { id: `${type}.${model}`, version: 1, name: info.name, type, model, category: categoryFor(type), description: info.character, parameters,
    dsp: { factory, backend: type === "gate" || type === "pitch" ? "audio-worklet" : "native", approximation: info.reference ? "Approximate character model; not a measured circuit or endorsed hardware model." : "Original algorithmic model; not a hardware capture or circuit emulation." }, reference: info.reference, source: info.source };
  registry.set(definition.id, definition);
}

// Each declaration owns its list. Reusable scalar constructors do not inherit a category panel.
define("input", "interface", [n("trim_db", "Input trim", "trim_db", -36, 12, 0, "dB"), toggle("mute", "Mute input"), toggle("invert", "Invert polarity", "invert", "switch")]);
define("gate", "gentle", [threshold(), release(), n("depth_db", "Depth", "depth_db", -90, 0, -60, "dB")]);
define("gate", "tight", [threshold(), n("attack_ms", "Attack", "attack_ms", 0.1, 50, 3, "ms", "log"), n("hold_ms", "Hold", "hold_ms", 0, 500, 50, "ms"), release(), n("hysteresis_db", "Hysteresis", "hysteresis_db", 0, 18, 6, "dB")]);
define("gate", "soft", [threshold(), release(), n("depth_db", "Floor", "depth_db", -90, 0, -60, "dB")]);
define("compressor", "studio", [n("threshold_db", "Threshold", "threshold_db", -60, 0, -24, "dBFS"), n("ratio", "Ratio", "ratio", 1, 20, 4), n("attack_ms", "Attack", "attack_ms", 0, 100, 10, "ms"), release(), n("knee_db", "Knee", "knee_db", 0, 40, 12, "dB"), n("makeup_db", "Makeup", "makeup_db", 0, 12, 0, "dB"), mix(1)]);
define("compressor", "sustain", [n("sustain", "Sustain", "threshold_db", 0, 1, 0.4, "", "linear", -60, 0), n("makeup_db", "Level", "makeup_db", 0, 12, 0, "dB"), mix(1)]);
define("compressor", "punch", [n("threshold_db", "Threshold", "threshold_db", -60, 0, -24, "dBFS"), n("attack_ms", "Attack", "attack_ms", 0, 100, 10, "ms"), release(), n("ratio", "Ratio", "ratio", 1, 20, 4), n("makeup_db", "Output", "makeup_db", 0, 12, 0, "dB")]);
define("boost", "clean", [n("gain_db", "Boost", "gain_db", 0, 18, 3, "dB")]);
define("boost", "treble", [n("gain_db", "Boost", "gain_db", 0, 18, 3, "dB"), tone()]);
define("boost", "mid", [n("gain_db", "Boost", "gain_db", 0, 18, 3, "dB"), n("focus", "Focus", "tone", 0, 1, 0.5)]);
define("wah", "classic", [{ ...n("position", "Pedal", "position", 0, 1, 0.5), widget: "slider" }, n("q", "Resonance", "q", 0.5, 12, 5), level()]);
define("wah", "wide", [n("position", "Sweep", "position", 0, 1, 0.5), n("q", "Resonance", "q", 0.5, 12, 5), mix(1), level()]);
define("wah", "vocal", [n("position", "Vowel", "position", 0, 1, 0.5), n("q", "Voice width", "q", 0.5, 12, 5), level()]);
define("overdrive", "green", [drive(), tone(), level()]);
define("overdrive", "gold", [drive(), tone(), level()]);
define("overdrive", "blue", [n("gain", "Gain", "drive", 0, 1, 0.25, "", "power"), tone(), level()]);
define("distortion", "orange", [n("distortion", "Distortion", "drive", 0, 1, 0.25, "", "power"), tone(), level()]);
define("distortion", "rodent", [n("distortion", "Distortion", "drive", 0, 1, 0.25, "", "power"), n("filter", "Filter", "tone", 0, 1, 0.5, "", "linear", -1, 1), level("Volume")]);
define("distortion", "gold", [n("distortion", "Distortion", "drive", 0, 1, 0.25, "", "power"), level("Output")]);
define("fuzz", "round", [drive("Fuzz"), level("Volume")]);
define("fuzz", "sustain", [drive("Sustain"), tone(), level("Volume")]);
define("fuzz", "velcro", [drive("Fuzz"), n("bias", "Bias", "bias", -0.4, 0.4, 0), tone(), level()]);
define("amp", "american_clean", [n("input_drive", "Input drive", "gain", 0, 1, 0.35, "", "power"), bass(), treble(), master(), toggle("bright", "Bright", "bright", "switch")]);
define("amp", "british_crunch", [ampGain(), bass(), mid(), treble(), presence(), master()]);
define("amp", "modern_high_gain", [ampGain(), bass(), mid(), treble(), presence(), n("resonance_db", "Resonance", "resonance_db", -6, 6, 0, "dB"), master(), toggle("bright", "Bright", "bright", "switch")]);
define("amp", "studio_clean", [n("volume_db", "Volume", "master_db", -24, 0, -6, "dB"), bass(), treble(), toggle("bright", "Bright", "bright", "switch")], "native.studio-clean.v1");
const mic = (second = false) => choice(second ? "mic2" : "mic", second ? "Second microphone" : "Microphone", ["dynamic", "ribbon", "condenser"], second ? "ribbon" : "dynamic");
const lowCut = () => frequency("low_cut_hz", "Low cut", 20, 500, 70);
const highCut = () => frequency("high_cut_hz", "High cut", 1000, 16000, 6500);
define("cabinet", "open_112", [mic(), n("position", "Mic position", "position", 0, 1, 0.4), n("distance", "Mic distance", "distance", 0, 1, 0.1), lowCut(), highCut(), level()]);
define("cabinet", "british_212", [mic(), n("position", "Mic position", "position", 0, 1, 0.4), mic(true), n("mic_blend", "Second mic blend", "mic_blend", 0, 1, 0), lowCut(), highCut(), level()]);
define("cabinet", "closed_412", [mic(), n("position", "Mic position", "position", 0, 1, 0.4), n("distance", "Mic distance", "distance", 0, 1, 0.1), mic(true), n("mic2_position", "Second mic position", "mic2_position", 0, 1, 0.7), n("mic2_distance", "Second mic distance", "mic2_distance", 0, 1, 0.2), n("mic_blend", "Second mic blend", "mic_blend", 0, 1, 0), n("mic2_delay_ms", "Second mic offset", "mic2_delay_ms", 0, 10, 0, "ms"), toggle("mic2_invert", "Invert second mic", "mic2_invert", "switch"), lowCut(), highCut(), level()]);
define("cabinet", "custom", [{ id: "ir_id", label: "Cabinet IR", type: "asset", widget: "asset", defaultValue: "none", unit: "", scaling: { type: "linear" }, choices: [], binding: { target: "ir_id", scale: 1, offset: 0 }, realtime: false }, lowCut(), highCut(), level()]);
const eqMid = () => [frequency("mid_hz", "Mid frequency", 100, 6000, 1000), n("mid_q", "Mid width (Q)", "mid_q", 0.2, 10, 0.8), n("mid_db", "Mid gain", "mid_db", -18, 18, 0, "dB")];
define("eq", "neutral", [frequency("low_cut_hz", "Low cut", 20, 500, 25), bass(), ...eqMid(), treble(), frequency("high_cut_hz", "High cut", 1000, 20000, 16000)]);
define("eq", "warm", [bass(), ...eqMid(), treble()]);
define("eq", "bright", [bass(), ...eqMid(), treble(), frequency("high_cut_hz", "Air cut", 1000, 20000, 16000)]);
define("eq", "tilt", [n("tilt_db", "Tilt", "bass_db", -12, 12, 0, "dB"), n("pivot_hz", "Pivot", "mid_hz", 100, 6000, 800, "Hz", "log")], "native.tilt-eq.v1");
define("chorus", "classic", [rate(), n("depth_ms", "Depth", "depth_ms", 0, 8, 3, "ms"), mix()]);
define("chorus", "wide", [rate(), n("depth_ms", "Depth", "depth_ms", 0, 8, 3, "ms"), n("delay_ms", "Base delay", "delay_ms", 10, 35, 18, "ms"), mix()]);
define("chorus", "dark", [rate(), n("depth_ms", "Depth", "depth_ms", 0, 8, 3, "ms"), mix()]);
define("flanger", "positive", [rate(), n("depth_ms", "Depth", "depth_ms", 0, 3, 1.5, "ms"), n("feedback", "Feedback", "feedback", -0.75, 0.75, 0.3), mix(0.5)]);
define("flanger", "negative", [rate(), n("depth_ms", "Depth", "depth_ms", 0, 3, 1.5, "ms"), n("delay_ms", "Base delay", "delay_ms", 3, 12, 3, "ms"), n("feedback", "Feedback", "feedback", -0.75, 0.75, 0.3), mix(0.5)]);
define("flanger", "wide", [rate(), n("depth_ms", "Depth", "depth_ms", 0, 3, 1.5, "ms"), n("feedback", "Feedback", "feedback", -0.75, 0.75, 0.3), mix(0.5)]);
define("phaser", "four", [rate(), n("depth", "Depth", "depth", 0, 1, 0.6), mix(0.5)]);
define("phaser", "six", [rate(), n("depth", "Depth", "depth", 0, 1, 0.6), frequency("center_hz", "Center", 200, 2500, 800), mix(0.5)]);
define("phaser", "eight", [rate(), n("depth", "Depth", "depth", 0, 1, 0.6), frequency("center_hz", "Center", 200, 2500, 800), mix(0.5)]);
define("tremolo", "sine", [n("rate_hz", "Speed", "rate_hz", 0.1, 20, 4, "Hz", "log"), n("depth", "Depth", "depth", 0, 1, 0.5)]);
define("tremolo", "triangle", [n("rate_hz", "Speed", "rate_hz", 0.1, 20, 4, "Hz", "log"), n("depth", "Depth", "depth", 0, 1, 0.5), mix(1)]);
define("tremolo", "square", [n("rate_hz", "Chop rate", "rate_hz", 0.1, 20, 4, "Hz", "log"), n("depth", "Depth", "depth", 0, 1, 0.5)]);
define("pitch", "fast", [n("semitones", "Transpose", "semitones", -12, 12, 0, "semitones"), mix(1)]);
define("pitch", "smooth", [n("semitones", "Transpose", "semitones", -12, 12, 0, "semitones"), n("cents", "Fine", "cents", -50, 50, 0, "cents"), mix(1)]);
define("pitch", "detune", [n("cents", "Stereo detune", "cents", -50, 50, 0, "cents"), mix(1)]);
define("delay", "digital", [timed(), feedback(), mix(), sync(), division()]);
define("delay", "analog", [timed(), feedback(), frequency("tone_hz", "Tone", 600, 12000, 6000), mix(), sync(), division()]);
define("delay", "ping_pong", [timed(), feedback(), mix(), sync(), division()]);
define("delay", "single_tap", [time(120), mix()], "native.single-tap.v1");
define("reverb", "room", [decay(), damping(), mix(0.2)]);
define("reverb", "plate", [decay(), predelay(), damping(), mix(0.2)]);
define("reverb", "spring", [decay(), predelay(), mix(0.2)]);
define("output", "protected", [n("level_db", "Output", "level_db", -48, -3, -18, "dB"), toggle("mute", "Mute output"), n("pan", "Pan", "pan", -1, 1, 0), n("width", "Stereo width", "width", 0, 1, 1), n("limiter_db", "Limiter ceiling", "limiter_db", -12, -1, -3, "dBFS"), n("limiter_release_ms", "Limiter release", "limiter_release_ms", 20, 500, 100, "ms", "log")]);

export function getGearModels(category?: GearCategory): GearModel[] { return structuredClone([...registry.values()].filter(model => !category || model.category === category)); }
export function getGearModel(id: string): GearModel { const model = registry.get(id); if (!model) throw new Error(`Unknown gear model: ${id}`); return structuredClone(model); }
export function modelFor(module: Pick<RigModule, "type" | "model">): GearModel { return getGearModel(`${module.type}.${module.model}`); }
export function validateModelValue(parameter: ModelParameter, value: Value): void {
  if (parameter.type === "number" && (typeof value !== "number" || !Number.isFinite(value) || value < parameter.min! || value > parameter.max!)) throw new Error(`Invalid ${parameter.label}.`);
  if (parameter.type === "boolean" && typeof value !== "boolean") throw new Error(`Invalid ${parameter.label}.`);
  if (parameter.type === "choice" && !parameter.choices.some(choice => choice.value === value)) throw new Error(`Invalid ${parameter.label}.`);
  if (parameter.type === "asset" && (typeof value !== "string" || !/^[a-zA-Z0-9_-]{1,64}$/.test(value))) throw new Error("Invalid IR asset ID.");
}
export function parameterToDSP(model: GearModel, id: string, value: Value): { target: string; value: Value; realtime: boolean } {
  const parameter = model.parameters.find(item => item.id === id); if (!parameter) throw new Error(`Unsupported ${model.name} parameter: ${id}`);
  validateModelValue(parameter, value);
  const mapped = typeof value === "number" ? value * parameter.binding.scale + parameter.binding.offset : value;
  validateControl(model.type, parameter.binding.target, mapped);
  return { target: parameter.binding.target, value: mapped, realtime: parameter.realtime };
}
export function modelValues(module: RigModule): Values {
  const values: Values = {};
  for (const parameter of modelFor(module).parameters) { const value = module.parameters[parameter.binding.target]; values[parameter.id] = typeof value === "number" ? (value - parameter.binding.offset) / parameter.binding.scale : value; }
  return values;
}
export function parseModelState(id: string, values: unknown): Values {
  const model = getGearModel(id);
  if (!values || typeof values !== "object" || Array.isArray(values) || Object.keys(values).length !== model.parameters.length || Object.keys(values).some(key => !model.parameters.some(parameter => parameter.id === key))) throw new Error("Model state must contain exactly its supported parameters.");
  for (const parameter of model.parameters) parameterToDSP(model, parameter.id, (values as Values)[parameter.id]);
  return structuredClone(values as Values);
}
export function createGearModule(modelId: string, id?: string, values?: Values): RigModule {
  const model = getGearModel(modelId), module = createRigModule(model.type, model.model, id);
  const own = parseModelState(modelId, values ?? Object.fromEntries(model.parameters.map(parameter => [parameter.id, parameter.defaultValue])));
  for (const [key, value] of Object.entries(own)) { const mapped = parameterToDSP(model, key, value); module.parameters[mapped.target] = mapped.value; }
  return module;
}
/** Explicit model selection resets only this gear; loading an old rig never calls this. */
export function changeGearModel(value: RigPreset, instanceId: string, modelId: string, irId?: string, reset = false): RigPreset {
  const next = parseRigPreset(value), previous = allRigModules(next).find(module => module.id === instanceId), model = getGearModel(modelId);
  if (!previous || previous.type !== model.type) throw new Error("Choose a model from the same gear family.");
  if (previous.model === model.model && !reset) return next;
  const values = Object.fromEntries(model.parameters.map(parameter => [parameter.id, parameter.defaultValue]));
  if (model.model === "custom") values.ir_id = irId ?? "none";
  const replacement = createGearModule(modelId, instanceId, values); replacement.on = previous.on; Object.assign(previous, replacement);
  for (const snapshot of next.snapshots) snapshot.values = snapshot.values.filter(item => item.id !== instanceId);
  const targets = model.parameters.filter(parameter => parameter.realtime && parameter.type === "number").map(parameter => parameter.binding.target);
  next.midi.bindings = next.midi.bindings.filter(binding => binding.module !== instanceId || targets.includes(binding.parameter));
  return parseRigPreset(next);
}
export function resetGearModel(value: RigPreset, instanceId: string): RigPreset {
  const module = allRigModules(value).find(item => item.id === instanceId); if (!module) throw new Error("Unknown gear instance.");
  return changeGearModel(value, instanceId, modelFor(module).id, String(module.parameters.ir_id ?? "none"), true);
}
export function legacyModelOverrides(module: RigModule): string[] {
  const model = modelFor(module), targets = model.parameters.map(parameter => parameter.binding.target), canonical = createGearModule(model.id);
  return Object.keys(module.parameters).filter(key => !targets.includes(key) && module.parameters[key] !== canonical.parameters[key]);
}
export function normalizeModelValue(parameter: ModelParameter, value: number): number {
  validateModelValue(parameter, value); if (parameter.type !== "number") throw new Error("Only numeric controls can be normalized.");
  const position = parameter.scaling.type === "log" ? Math.log(value / parameter.min!) / Math.log(parameter.max! / parameter.min!) : (value - parameter.min!) / (parameter.max! - parameter.min!);
  return parameter.scaling.type === "power" ? position ** (1 / (parameter.scaling.exponent ?? 2)) : position;
}
export function denormalizeModelValue(parameter: ModelParameter, position: number): number {
  if (!Number.isFinite(position) || position < 0 || position > 1 || parameter.type !== "number") throw new Error("Invalid normalized model value.");
  const fraction = parameter.scaling.type === "power" ? position ** (parameter.scaling.exponent ?? 2) : position;
  const value = parameter.scaling.type === "log" ? parameter.min! * (parameter.max! / parameter.min!) ** fraction : parameter.min! + fraction * (parameter.max! - parameter.min!);
  return Math.max(parameter.min!, Math.min(parameter.max!, value));
}

// Fail closed when a legacy catalog entry lacks explicit model metadata.
for (const type of RIG_MODULE_TYPES) for (const model of moduleDefinition(type).models) if (!registry.has(`${type}.${model.id}`)) throw new Error(`Missing gear definition: ${type}.${model.id}`);
