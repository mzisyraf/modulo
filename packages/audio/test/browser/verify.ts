import { AudioEngine, createRigPreset, createRigModule, factoryRigPresets, getRigCatalog, encodeRigWav, CabinetIRLibrary, renderRigFile, importRigPreset, exportRigPreset, type RigPreset, type ModuleType } from "../../src/index.ts";
import { RigGraph, prepareRig } from "../../src/rig/graph.ts";
import v1 from "../../../../fixtures/preset.example.json";

export async function verifyRig() {
  const checks: { name: string; passed: boolean; error?: string }[] = [];
  const check = async (name: string, body: () => void | Promise<void>) => { try { await body(); checks.push({ name, passed: true }); } catch (error) { checks.push({ name, passed: false, error: String(error instanceof Error ? error.stack : error) }); } };
  const assert = (value: unknown, message: string) => { if (!value) throw new Error(message); };
  const rms = (samples: Float32Array, start = 0, end = samples.length) => Math.sqrt(samples.slice(start, end).reduce((sum, value) => sum + value * value, 0) / (end - start));
  const delta = (a: Float32Array, b: Float32Array) => Math.sqrt(a.reduce((sum, value, i) => sum + (value - b[i]) ** 2, 0) / a.length);
  const rigFor = (type?: ModuleType, model?: string) => {
    const rig = createRigPreset("DSP verification"); rig.chain = [createRigModule("input"), ...(type ? [createRigModule(type, model, "effect")] : []), createRigModule("output")];
    rig.chain.at(-1)!.parameters.level_db = -12; return rig;
  };
  const render = async (rig: RigPreset, kind: "tone" | "impulse" = "tone", bypass = false) => {
    const context = new OfflineAudioContext(2, 48000, 48000); await prepareRig(context, rig);
    const graph = new RigGraph(context, rig, new CabinetIRLibrary()), source = context.createBufferSource(), buffer = context.createBuffer(1, 48000, 48000), data = buffer.getChannelData(0);
    for (let i = 0; i < data.length; i++) data[i] = kind === "impulse" ? (i === 1000 ? 0.5 : 0) : (i < 30000 ? 0.15 * Math.sin(2 * Math.PI * 220 * i / 48000) + 0.06 * Math.sin(2 * Math.PI * 1320 * i / 48000) : 0);
    source.buffer = buffer; source.connect(graph.input); graph.output.connect(context.destination); graph.setBypass(bypass); source.start();
    try { return await context.startRendering(); } finally { graph.dispose(); source.disconnect(); }
  };
  const baseline = (await render(rigFor())).getChannelData(0);
  const stats: Record<string, { rms: number; difference: number }> = {};
  for (const [type, definition] of Object.entries(getRigCatalog())) if (!["input", "output"].includes(type)) {
    for (const model of definition.models) if (model.id !== "custom") await check(`render ${type}/${model.id}`, async () => {
      const rig = rigFor(type as ModuleType, model.id), effect = rig.chain[1];
      if (type === "pitch") effect.parameters.semitones = 7;
      if (type === "gate") effect.parameters.threshold_db = -10;
      if (type === "compressor") effect.parameters.threshold_db = -40;
      if (type === "eq") effect.parameters.mid_db = 10;
      if (type === "eq") effect.parameters.bass_db = 6;
      const buffer = await render(rig), samples = buffer.getChannelData(0), difference = delta(samples, baseline);
      assert(samples.every(Number.isFinite), "nonfinite output"); assert(rms(samples) > 0, "silent output");
      assert(difference > 0.00001, "effect did not change audio"); stats[`${type}/${model.id}`] = { rms: rms(samples), difference };
    });
  }
  await check("global bypass skips effects and retains input/output protection", async () => {
    const rig = rigFor("distortion", "orange"), result = (await render(rig, "tone", true)).getChannelData(0);
    // Bypass gain ramps settle within 200ms; compare steady state.
    assert(delta(result.slice(12000), baseline.slice(12000)) < 0.000001, "bypass differs from protected clean route");
  });
  await check("delay and reverb produce finite tails after an impulse", async () => {
    for (const type of ["delay", "reverb"] as const) {
      const samples = (await render(rigFor(type), "impulse")).getChannelData(0);
      assert(rms(samples, 10000, 47000) > 0.000001, `${type} tail missing`);
    }
  });
  for (const rig of factoryRigPresets()) await check(`factory ${rig.name}`, async () => {
    const samples = (await render(importRigPreset(exportRigPreset(rig)))).getChannelData(0);
    assert(samples.every(Number.isFinite) && rms(samples) > 0.00001, "factory silent/nonfinite");
  });
  await check("dual microphones change the cabinet response", async () => {
    const rig = rigFor("cabinet"), first = (await render(rig)).getChannelData(0);
    rig.chain[1].parameters.mic_blend = 0.75;
    assert(delta(first, (await render(rig)).getChannelData(0)) > 0.0001, "mic mix did not change response");
  });
  await check("parameter automation preserves independent scheduled controls", async () => {
    const context = new OfflineAudioContext(2, 48000, 48000), rig = rigFor("boost"); rig.chain[1].parameters.gain_db = 0;
    const graph = new RigGraph(context, rig, new CabinetIRLibrary()), oscillator = context.createOscillator(), gain = context.createGain();
    oscillator.frequency.value = 220; gain.gain.value = 0.03; oscillator.connect(gain).connect(graph.input); graph.output.connect(context.destination);
    graph.setParameter("effect", "gain_db", 12, 0.5); graph.setParameter("effect", "tone", 0.5, 0.1); oscillator.start();
    try { const buffer = await context.startRendering(), samples = buffer.getChannelData(0); assert(rms(samples, 35000, 47000) / rms(samples, 5000, 15000) > 3, "one control canceled another control's scheduled automation"); } finally { oscillator.stop(); graph.dispose(); }
  });
  await check("maximum EQ stacks remain finite within stage headroom", async () => {
    const rig = rigFor(); rig.chain.splice(1, 0, ...Array.from({ length: 22 }, (_, i) => {
      const item = createRigModule("eq", "neutral", `eq${i}`); item.parameters.bass_db = 12; item.parameters.mid_db = 18; item.parameters.treble_db = 12; return item;
    }));
    const samples = (await render(rig)).getChannelData(0);
    assert(samples.every(value => Number.isFinite(value) && Math.abs(value) <= 8.001), "unbounded/nonfinite stacked EQ");
  });
  const wait = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));
  await check("real engine preset changes, snapshots, MIDI, tuner, monitoring and stop/restart", async () => {
    const engine = new AudioEngine(v1 as any), context = new AudioContext(), oscillator = context.createOscillator(), level = context.createGain(), stream = context.createMediaStreamDestination();
    const original = navigator.mediaDevices.getUserMedia.bind(navigator.mediaDevices); let produced: MediaStream | undefined;
    oscillator.frequency.value = 110; level.gain.value = 0.1; oscillator.connect(level).connect(stream); oscillator.start(); await context.resume();
    navigator.mediaDevices.getUserMedia = async () => { produced = stream.stream.clone(); return produced; };
    try {
      await engine.applyRigPreset(factoryRigPresets()[0]); assert(await engine.startLive(undefined, 0), "live not started");
      engine.getInputLevel(); engine.getTunerReading(); await wait(200);
      assert(engine.getInputLevel()!.peak > 0.01, "raw meter not connected");
      const tuner = engine.getTunerReading(); assert(tuner && Math.abs(tuner.frequencyHz - 110) < 2, "dry tuner incorrect");
      engine.saveRigSnapshot("saved", "Saved"); engine.setRigParameter("amp", "gain", 0.6); await engine.loadRigSnapshot("saved");
      assert(engine.getRigPreset()!.chain.find(item => item.id === "amp")!.parameters.gain === 0.35, "snapshot failed");
      await engine.midi.handle([0xb0, 11, 127]); assert(engine.getRigPreset()!.chain.find(item => item.id === "amp")!.parameters.gain === 0.7, "MIDI failed");
      engine.setRigExpression("amp", "gain", 0.5, 0, 1); assert(engine.getRigPreset()!.chain.find(item => item.id === "amp")!.parameters.gain === 0.5, "expression failed");
      engine.setRigModuleEnabled("delay", true); engine.setRigTempo(90);
      let failed = false; try { engine.setRigParameter("amp", "gain", Infinity); } catch { failed = true; } assert(failed, "bad control accepted");
      const before = engine.getRigPreset()!.name, bad = rigFor("cabinet", "custom"); bad.chain[1].parameters.ir_id = "missing";
      try { await engine.applyRigPreset(bad); } catch { /* Expected missing asset. */ } assert(engine.getRigPreset()!.name === before, "failed replacement destroyed active rig");
      engine.setTunerMuted(true);
      await wait(200);
      const takePromise = engine.startRigRecording({ mode: "both" }); await wait(800); engine.finishRigRecording(); const take = await takePromise;
      assert(take.dry!.blob.size > 0 && take.wet!.blob.size > 0, "dual files missing");
      const dry = await context.decodeAudioData(await take.dry!.blob.arrayBuffer()), wet = await context.decodeAudioData(await take.wet!.blob.arrayBuffer());
      assert(rms(dry.getChannelData(0)) > 0.01 && rms(wet.getChannelData(0)) < 0.001, `dry/wet taps are not separate: dry=${rms(dry.getChannelData(0))}, wet=${rms(wet.getChannelData(0))}`);
      const pending = engine.startRigRecording({ mode: "wet" }); await wait(400); engine.stop(); assert((await pending).wet!.stopReason === "source_stopped", "stop did not finalize");
      assert(produced!.getTracks()[0].readyState === "ended", "capture track leaked");
      assert(await engine.startLive(), "restart failed"); engine.setTunerMuted(false); await wait(100);
      assert(engine.getDiagnostics().measuredRoundTripLatencySeconds === null && engine.getDiagnostics().graph!.nodeCount > 0, "misleading diagnostics");
      engine.applyPreset(v1 as any); assert(engine.getRigPreset() === null, "v1 did not restore");
    } finally { navigator.mediaDevices.getUserMedia = original; await engine.dispose(); oscillator.stop(); await context.close(); }
  });
  await check("stop during worklet preparation cannot replace the active mode", async () => {
    const engine = new AudioEngine(v1 as any);
    try { const pending = engine.applyRigPreset(createRigPreset()); engine.stop(); assert(await pending === false && engine.getRigPreset() === null, "stopped rig load became active"); }
    finally { await engine.dispose(); }
  });
  await check("stopped delay tails do not return on the next source", async () => {
    const engine = new AudioEngine(v1 as any), context = new OfflineAudioContext(1, 1, 48000), silence = context.createBuffer(1, 48000, 48000);
    try {
      const rig = rigFor("delay"); rig.chain[1].parameters.feedback = 0.8; rig.chain[1].parameters.mix = 1;
      await engine.applyRigPreset(rig); await engine.playTestSignal(); await wait(500); engine.stop();
      await engine.playFile(new File([encodeRigWav(silence)], "silence.wav"));
      const pending = engine.startRigRecording({ mode: "wet" }); await wait(500); engine.finishRigRecording(); const take = await pending;
      const decoded = await context.decodeAudioData(await take.wet!.blob.arrayBuffer()); assert(rms(decoded.getChannelData(0)) < 0.00001, "old delay tail returned");
    } finally { await engine.dispose(); }
  });
  await check("bounded custom IR import and offline WAV rendering", async () => {
    const decoder = new OfflineAudioContext(1, 1, 48000), ir = decoder.createBuffer(1, 2400, 48000); ir.getChannelData(0)[0] = 1;
    const library = new CabinetIRLibrary(), info = await library.load("test_ir", new File([encodeRigWav(ir)], "test.wav"), decoder);
    assert(info.hash.length === 64 && info.source === "user", "IR provenance missing");
    const rig = rigFor("cabinet", "custom"); rig.chain[1].parameters.ir_id = info.id;
    const audio = decoder.createBuffer(1, 4800, 48000); for (let i = 0; i < audio.length; i++) audio.getChannelData(0)[i] = Math.sin(i * 0.1) * 0.1;
    const file = new File([encodeRigWav(audio)], "dry.wav"), rendered = await renderRigFile(file, rig, { tailSeconds: 0.3 }, library);
    assert(rendered.mimeType === "audio/wav" && Math.abs(rendered.durationSeconds - 0.4) < 0.001, "offline duration/format wrong");
    const decoded = await decoder.decodeAudioData(await rendered.blob.arrayBuffer()); assert(decoded.numberOfChannels === 2 && rms(decoded.getChannelData(0)) > 0.001, "offline WAV not playable");
    let rejected = false; try { await library.load("too_long", new File([encodeRigWav(decoder.createBuffer(1, 25000, 48000))], "bad.wav"), decoder); } catch { rejected = true; } assert(rejected, "long IR accepted");
    const controller = new AbortController(); controller.abort(); rejected = false; try { await renderRigFile(file, rig, { signal: controller.signal }, library); } catch (error) { rejected = (error as Error).name === "AbortError"; } assert(rejected, "render cancellation ignored");
  });
  return { browser: navigator.userAgent, fixture: "synthetic audio; no guitar/interface/MIDI hardware acceptance", passed: checks.filter(item => item.passed).length, failed: checks.filter(item => !item.passed).length, checks, stats };
}
