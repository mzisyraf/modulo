import { AudioEngine, createGearModule, createRigModule, createRigPreset, modelFor, modelValues, parameterToDSP, exportRigPreset, importRigPreset, type RigModule, type RigPreset, type Value } from "../../src/index.ts";
import { RigGraph, prepareRig } from "../../src/rig/graph.ts";
import { CabinetIRLibrary } from "../../src/rig/impulses.ts";
import v1 from "../../../../fixtures/preset.example.json";

export async function verifyRig() {
  const checks: { name: string; passed: boolean; error?: string }[] = [], evidence: Record<string, number> = {};
  const check = async (name: string, action: () => unknown) => { try { await action(); checks.push({ name, passed: true }); } catch (error) { checks.push({ name, passed: false, error: String(error instanceof Error ? error.stack : error) }); } };
  const assert = (value: unknown, message: string) => { if (!value) throw new Error(message); };
  const difference = (a: Float32Array, b: Float32Array) => Math.sqrt(a.reduce((sum, value, i) => sum + (value - b[i]) ** 2, 0) / a.length);
  const render = async (module: RigModule, impulse = false, inputScale = 1) => {
    const context = new OfflineAudioContext(2, 57600, 48000), rig = createRigPreset("Model verification");
    rig.chain = [createRigModule("input"), structuredClone(module), createRigModule("output")]; await prepareRig(context, rig);
    const graph = new RigGraph(context, rig, new CabinetIRLibrary()), source = context.createBufferSource(), buffer = context.createBuffer(1, 57600, 48000), data = buffer.getChannelData(0);
    let seed = 1207;
    for (let i = 0; i < data.length; i++) {
      seed = (1664525 * seed + 1013904223) >>> 0; const noise = seed / 2147483648 - 1;
      data[i] = impulse ? (i === 4800 ? 0.5 : 0) : noise * 0.0005 + (i > 2400 && i < 18000 ? (Math.sin(i * 2 * Math.PI * 110 / 48000) * 0.12 + Math.sin(i * 2 * Math.PI * 880 / 48000) * 0.06 + Math.sin(i * 2 * Math.PI * 6300 / 48000) * 0.04) : 0);
      data[i] *= inputScale;
    }
    source.buffer = buffer; source.connect(graph.input); const guard = context.createWaveShaper(); guard.curve = new Float32Array([-0.95, 0, 0.95]); graph.output.connect(guard).connect(context.destination); source.start();
    try { const result = await context.startRendering(); assert(result.getChannelData(0).every(value => Number.isFinite(value) && Math.abs(value) <= 0.951), "unsafe model output"); return result.getChannelData(0).slice(); }
    finally { graph.dispose(); source.disconnect(); guard.disconnect(); }
  };
  const models = ["amp.studio_clean", "amp.american_clean", "amp.modern_high_gain", "distortion.gold", "distortion.rodent", "delay.single_tap", "delay.digital", "eq.tilt", "compressor.sustain", "gate.gentle"];
  for (const id of models) {
    const module = createGearModule(id, "tested"), model = modelFor(module);
    for (const parameter of model.parameters) await check(`${id}/${parameter.id} changes rendered DSP`, async () => {
      const variants: Value[] = parameter.type === "number" ? [parameter.min!, parameter.max!] : parameter.type === "boolean" ? [false, true] : parameter.choices.map(choice => choice.value);
      const a = structuredClone(module), b = structuredClone(module);
      if (parameter.id === "pivot_hz") { a.parameters.bass_db = 8; b.parameters.bass_db = 8; }
      if (parameter.visibleWhen) { const condition = parameterToDSP(model, parameter.visibleWhen.parameter, parameter.visibleWhen.equals); a.parameters[condition.target] = condition.value; b.parameters[condition.target] = condition.value; }
      const first = parameterToDSP(model, parameter.id, variants[0]), last = parameterToDSP(model, parameter.id, variants.at(-1)!); a.parameters[first.target] = first.value; b.parameters[last.target] = last.value;
      const delta = difference(await render(a), await render(b)); evidence[`${id}/${parameter.id}`] = delta;
      assert(delta > 1e-7, `${parameter.label} is not affecting its processor (RMS difference ${delta})`);
    });
  }
  await check("single-tap and feedback delay use different echo topology", async () => {
    const single = createGearModule("delay.single_tap", "tested"), feedback = createGearModule("delay.digital", "tested");
    for (const module of [single, feedback]) { module.parameters.time_ms = 100; module.parameters.mix = 1; }
    feedback.parameters.feedback = 0.6;
    const a = await render(single, true), b = await render(feedback, true);
    const energy = (samples: Float32Array, start: number, end: number) => samples.slice(start, end).reduce((sum, value) => sum + value * value, 0);
    assert(energy(a, 14000, 50000) < 1e-12 && energy(b, 14000, 50000) > 1e-6, "single tap repeats or feedback delay lacks repeats");
  });
  await check("linear studio preamp has no nonlinear gain stage", async () => {
    const studio = createGearModule("amp.studio_clean", "tested"), gain = createGearModule("amp.modern_high_gain", "tested");
    const clean = await render(studio), doubled = await render(studio, false, 2);
    assert(difference(Float32Array.from(clean, value => value * 2), doubled) < 1e-6, "linear preamp does not scale linearly below output limits");
    assert(difference(clean, await render(gain)) > 0.005, "different processor factories sound numerically identical");
  });
  await check("model API rejects unsupported controls and observers cannot break the engine", async () => {
    const engine = new AudioEngine(v1 as any), rig = createRigPreset(); rig.chain[4] = createGearModule("amp.studio_clean", "amp");
    try {
      engine.onRigChange = () => { throw new Error("Deliberate UI failure"); }; assert(await engine.applyRigPreset(rig), "observer broke load");
      let rejected = false; try { await engine.setModelParameter("amp", "gain", 0.5); } catch { rejected = true; } assert(rejected, "unsupported studio gain accepted");
      await engine.setModelParameter("amp", "volume_db", -12); assert(engine.getRigPreset()!.chain.find(item => item.id === "amp")!.parameters.master_db === -12, "model API mapping failed");
      engine.learnModelMidi("amp", "volume_db", -24, 0); await engine.midi.handle([0xb0, 7, 127]); assert(engine.getRigPreset()!.chain.find(item => item.id === "amp")!.parameters.master_db === 0, "model MIDI endpoint mapping failed");
      assert(exportRigPreset(importRigPreset(exportRigPreset(engine.getRigPreset()!))) === exportRigPreset(engine.getRigPreset()!), "rig state lost during persistence");
      engine.applyPreset(v1 as any); assert(engine.getRigPreset() === null, "legacy provider workflow not restored");
    } finally { await engine.dispose(); }
  });
  return { browser: navigator.userAgent, fixture: "Synthetic native/worklet model DSP; no physical rig or hardware authenticity acceptance", passed: checks.filter(item => item.passed).length, failed: checks.filter(item => !item.passed).length, checks, evidence };
}
