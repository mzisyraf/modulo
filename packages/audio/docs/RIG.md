# Rig engine and frontend handoff

This is Dinnie's audio implementation of the four requested tiers. The engine
has real processing for the catalog entries below. A model-specific React panel
is wired into the main Tone Match view and shares controls with the audio
workbench. Isyraf and Shazlin still need to review this additive interface and
UI integration before staging adoption. See [MODEL_ARCHITECTURE.md](MODEL_ARCHITECTURE.md)
for the model registry, DSP examples, reference study and licence findings.

`RigPreset` is an **experimental local engine configuration**, with
`rig_version: "1"`. It is not a provider response. The shared
`contracts/preset.schema.json` and `AudioEngine.applyPreset(Preset)` remain the
existing inference/runtime boundary. Never cast a model/provider result to
`RigPreset`, or report automatic full-rig generation as implemented.

## Try it now

Use Node 24, install from the repository root with `npm ci`, then:

```sh
npm run dev:rig --workspace @modulo/audio
```

Open http://127.0.0.1:5175/. Click **Load factory rig**, then **Play test signal**
or start live input. No backend is required. The default output is -18 dB.
Use wired headphones and the same known working interface channel. The
previous Scarlett Solo 4th-generation self-building sound with Drive enabled
remains a separate, unresolved hardware/routing/listening investigation.
Stop immediately if it returns. These changes do not establish its cause or fix.

The workbench shows a compact, horizontally scrolling signal chain and one
selected module's controls. A separate horizontal gear library always includes
all 17 editable gear families, regardless of the factory rig. Drag a library
handle into a chain gap to add gear, drag placed handles to reorder or move
between parallel paths, and drop placed gear in the removal area to remove it.
Add/destination, move-arrow and Remove buttons support keyboard/touch use.
Input and Output stay fixed. Removing a parallel split module moves the split
to its previous main-chain module; snapshots/CC references to removed gear are
cleaned up. All models remain selectable in each dropdown; starred groups mark
the loaded factory rig's starting choices, not a restriction or tone-match score.
Imported/JSON-defined rigs have no automatic factory recommendation badge.

The workbench supports catalog/model/parameter choices, enable/bypass, input
device/channel selection, dry meter, monophonic tuner, snapshots, MIDI connect,
temporary dry/wet takes with playback/download, custom IR loading, JSON preset
import/export and offline WAV rendering. Edit the JSON for parallel
path level/pan and MIDI assignments. The workbench is an
audio development tool; Shazlin owns the main product UI.

## Implemented tiers

| Tier | Audio implementation |
| --- | --- |
| Core | Selected input channel, trim/mute/polarity, hysteretic gate with hold/attack/release, native compressor with parallel mix, oversampled overdrive, two-stage nonlinear amp with tone stack, actual cabinet convolution, post EQ, feedback delay, convolution reverb, stereo output/limiter and final sample bound |
| Expanded | Boost, asymmetric fuzz with bias/DC blocking, distortion, stereo modulated-delay chorus/flanger, 4/6/8-stage phaser, three tremolo waveforms, resonant wah, granular pitch/detune |
| Advanced | Two bounded parallel paths; two independent amp/cab chains in the dual factory rig; two-microphone cabinet blend, polarity and offset; snapshots; MIDI CC mapping/learn; program-to-snapshot changes; expression mapping; native parameter scheduling |
| Production | Pre-trim dry and protected wet recording, offline rendering through the same graph, validated preset JSON import/export, custom-IR provenance, device/context latency estimates and bounded graph resource diagnostics |

Five factory rigs: Modern High Gain (Rhythm/Lead snapshots and example MIDI
assignments), American Clean, Ambient Stereo, Expanded Pedalboard (extra pedals
initially off), Dual Clean / Crunch. Every returned factory/catalog object is
independent and safe to edit before validation.

## Catalog and brand references

`getGearModels()` is the model-specific catalog, organized into 14 gear
categories. Each model declares its own parameter IDs, labels, types, widgets,
defaults, bounds, units, scaling, choices and DSP bindings. `getRigCatalog()` is
retained for the legacy category/DSP wire format; do not use its category knob
lists to build new model controls. `createGearModule(modelId, uniqueId?)` builds
model defaults. `on` enables a module; input/output cannot be bypassed.
The catalog has 19 wire module types, 56 built-in processing characters plus a custom
cabinet option (including the single input and output models).

| Type | Choices |
| --- | --- |
| Gate | Gentle, Tight, Soft expander |
| Compressor | Studio, Pedal sustain, Punch |
| Overdrive | TS808-inspired Green, SD-1-inspired Yellow, BD-2-inspired Blue |
| Distortion | DS-1-inspired Orange, Pro Co RAT2-inspired Rodent, MXR Distortion+-inspired Gold |
| Fuzz | Round vintage, Sustain, Velcro |
| Boost / wah | Clean/Treble/Mid boost; Classic/Wide/Vocal wah |
| Amp | American Clean, British Crunch, Modern High Gain |
| Cabinet | Open 1×12, British 2×12, Closed 4×12 synthetic IRs; user IR |
| EQ | Neutral/Warm/Bright shelf pivots, one parametric mid band, low/high cuts |
| Chorus / flanger | Classic/Wide/Dark chorus; Positive/Negative/Wide flange |
| Phaser / tremolo | Four/Six/Eight-stage phase; Sine/Triangle/Chop tremolo |
| Pitch | Fast/Smooth granular shift, Wide opposing stereo detune |
| Delay / reverb | Digital/Analog-style/Ping-pong; Room/Plate-style/Spring-style synthetic IRs |

Additional original models: Studio Clean Preamp (linear two-band preamp),
Single Tap / Slapback (feed-forward delay without feedback) and Tilt EQ
(complementary shelves with movable pivot). These have dedicated processor
factories and small, verified control sets. Existing approximation models are
explicit legacy-processor adapters with model-owned controls. Legacy presets
retain all stored values; a visible notice identifies non-default adjustments
outside a model's new panel, with an explicit Reset model defaults action.

**All branded names are approximate inspirations, not circuit simulations,
licensed models, endorsed products or measured tone matches.** The model
coefficients are original DSP choices. Product references only identify the
inspiration: [Ibanez TS808](https://www.ibanez.com/eu/products/detail/ts808_99.html),
[BOSS SD-1](https://support.roland.com/hc/en-us/articles/201952119-SD-1-Specifications),
[BOSS BD-2](https://static.roland.com/assets/media/pdf/BD-2_M_eng02_W.pdf),
[BOSS DS-1](https://www.boss.info/global/products/ds-1/),
[Pro Co RAT2](https://actentertainment.com/rat-2-distortion-pedal/),
[MXR Distortion+](https://www.jimdunlop.com/mxr-distortion/).
Other characters have original generic names. Cabinet/microphone responses and
room/plate/spring reverbs are generated synthetic responses, not hardware captures.
Pitch uses two crossfaded delay grains; it adds roughly 30–60 ms of grain buffering
and can produce artifacts on chords. No neural amp, physical spring, polyphonic
pitch or hardware-accurate microphone model is claimed.

## Connect the frontend

Use **the existing engine instance** so sample/live/calibration/recording lifecycle
stays in one place. Do not create a second monitoring graph.

```ts
import {
  createRigPreset, getRigCatalog, exportRigPreset, importRigPreset,
  factoryRigPresets,
} from "@modulo/audio";

const catalog = getRigCatalog();
const rig = createRigPreset();
await engine.applyRigPreset(rig); // user gesture; false = canceled by stop/newer load
await engine.startLive(deviceId, 0); // same zero-based channel convention
engine.setRigParameter("amp", "gain", 0.4);
engine.setRigModuleEnabled("delay", true);
engine.setBypass(true); // input trim and protected output remain active
engine.setTunerMuted(true); // mute monitoring, retain dry tuner/recording
engine.getTunerReading(); // poll at most 10 Hz; first analyser read may be empty
engine.getDiagnostics();
const json = exportRigPreset(engine.getRigPreset()!);
await engine.applyRigPreset(importRigPreset(json));
// Existing provider preset workflow remains available:
engine.applyPreset(providerPreset); // exits rig mode and restores legacy processing
```

New UI code uses `modelFor(module)` / `modelValues(module)` and
`engine.setModelParameter(instanceId, parameterId, value)` instead of the legacy
wire-parameter API. `changeGearModel` resets this gear's model defaults and
removes its old snapshot values/incompatible CC mappings; changing the model
does not inherit old knobs. `ModelControls.tsx` is the shared React renderer.
The main app reuses its existing engine/capture/recorder, disables the legacy
editor while model mode is active, and preserves model rigs in tab-local project
sessions. JSON save/load retains the established engine rig format. Model rigs
remain local manual setups, not full-rig provider inference.

Changing order/model/buffer controls requires `applyRigPreset` with the complete
validated rig. Compatible changes update in place; structural changes build first
and crossfade for 100 ms. A missing IR or validation/build failure leaves the old
graph intact. Older asynchronous loads cannot overwrite newer loads/stop/dispose.
`getRigPreset()` returns a copy. `onRigError` reports worklet failure after stopping
monitoring. Stop immediately silences effect tails; starting another source creates
a fresh graph so old delay/reverb audio cannot return. Sample end uses the same
Stop behavior. Offline rendering supports an explicit tail instead.

Only controls marked `realtime` support `setRigParameter`. Values are validated
without coercion. Numeric/boolean controls ramp over 15 ms; gate/pitch messages
are immediate at worklet-block boundaries. Native numeric controls can be scheduled
up to 60 seconds ahead using `atTime` from the context clock:

```ts
engine.setRigParameter("amp", "gain", 0.6,
  engine.getDiagnostics().contextTimeSeconds! + 0.5);
```

Scheduling a control preserves schedules for independent controls. An immediate
change to the same AudioParam overrides its pending schedule. Full rig/snapshot
updates reset relevant schedules; this is not a recorded automation-lane editor.
`getRigPreset()` records the requested target value, including future targets.
Gate/pitch controls reject future scheduling; use immediate MIDI changes.

### Parallel paths, snapshots, MIDI and expression

`factoryRigPresets().find(rig => rig.parallel)` demonstrates two amps/cabs. A
split after a root module runs two branch chains, sums them with per-path level
and pan, then resumes the root chain. No cycles or recursive routing. Suggested
branch gain is -6 dB each. Per-path changes currently use `applyRigPreset`.
Cabinet parameters include independent mic type/position/distance, blend,
second-mic delay (0–10 ms) and polarity. Model/position/distance/mic/IR changes
rebuild the buffer; mix/level/cuts/delay/polarity update live.

```ts
engine.saveRigSnapshot("rhythm", "Rhythm");
await engine.loadRigSnapshot("rhythm");
engine.setRigExpression("amp", "gain", pedalPosition, 0.1, 0.7, "squared");
await engine.midi.connect(); // explicit user gesture; no SysEx
engine.midi.learn("amp", "gain", 0.1, 0.7, "squared"); // move the desired CC
engine.midi.cancelLearn();
engine.midi.disconnect();
```

MIDI data uses zero-based channels (0–15), CC/program values 0–127. CC targets
must be numeric realtime controls; program assignments select snapshot IDs.
Use snapshots for effect enable/disable changes. Inputs reconnect through MIDI
state-change listeners; disconnect/dispose removes listeners and invalidates late
permission results. `midi.onError`/`onLearn` let the UI report state. No permission
is requested by rig construction. Physical controllers still require real testing.

### Cabinet assets and preset import/export

```ts
const info = await engine.loadCabinetIR("my_cab", file);
const preset = engine.getRigPreset()!;
const cabinet = preset.chain.find(module => module.type === "cabinet")!;
cabinet.model = "custom";
cabinet.parameters.ir_id = info.id;
await engine.applyRigPreset(preset);
```

User IRs are limited to 12 entries, 2 MiB encoded, mono/stereo and 500 ms decoded.
Nonfinite/silent data rejects. Average channel L1 norm is bounded and preserved
when resampling. Metadata includes original filename, decoded sample rate and
SHA-256 of file bytes. Files stay local. Active IDs cannot be replaced/unloaded;
use a new ID or remove the reference first. Closing the engine clears its library.
Presets contain IR IDs, not audio; export the referenced files/metadata separately
and import them before applying a custom-IR preset. Missing assets fail explicitly.

JSON must be at most 256 KiB. Validation rejects unknown fields/models, invalid
or missing parameters, nonfinite values, duplicate IDs, invalid split points,
unsafe references or missing snapshots. Limits: 24 root modules, two paths of
up to 12 modules each, 32 modules total, four cabinets, two reverbs, 16 snapshots,
64 MIDI CC mappings and 128 program assignments. Input/output remain mandatory.

### Recording and offline rendering

```ts
const pending = engine.startRigRecording({ mode: "both", maxSeconds: 60 });
// UI switches to Recording; catch AbortError on discard/project change.
engine.finishRigRecording(); // UI shows Finalizing until pending settles
const { dry, wet, alignment } = await pending;
// dry/wet: optional PerformanceTake; use each returned MIME type/extension
engine.cancelRigRecording();

const controller = new AbortController();
const render = await engine.renderRigFile(dryFile, {
  sampleRate: 48000, channel: 0, tailSeconds: 2, signal: controller.signal,
});
// render.blob is stereo PCM16 WAV; render.buffer is the rendered AudioBuffer.
```

Dry capture taps the source before app input trim, gate, effects, master/mute;
live capture always uses the selected physical channel. Wet capture taps after
the existing final output guard and follows monitoring, including tuner mute.
Both use independent native browser encoders: they share a context start-time
reference but have padding/latency differences and are **not sample aligned**.
Limits are 180 seconds and 50 MiB combined (half budget per file in `both` mode).
Existing performance recording and rig recording are mutually exclusive; both
finish on source stop and cancel on dispose. Capture permission is not requested
again. UI/project tokens and completed Blob URL lifecycle remain the UI's job.

Offline rendering uses the same `RigGraph`/IR library in `OfflineAudioContext`,
selects a mono guitar channel and emits stereo 16-bit WAV at 44.1/48/96 kHz.
Input: <=20 MiB encoded, <=180 seconds decoded, mono/stereo. Tail: 0–8 seconds.
Output <=50 MiB. Decoded size checks occur after native decoding. Rendering does
not play through speakers or change monitoring. Abort rejects/discards results
and disconnects the graph; browser-native decode/render work itself cannot be
forcibly interrupted. A tail may be truncated by the chosen duration.

### Diagnostics and physical limits

`getDiagnostics()` reports context state/time/sample rate, browser base/output
latency estimates, capture settings, module/node count, convolution duration,
retiring graph count, compressor reduction, custom IR count and worklet quantum
size when actually reported. `measuredRoundTripLatencySeconds`,
`audioThreadCpuPercent`, `dropoutCount` stay null: browsers expose no reliable
measurement of these through this API. Native compressor lookahead, pitch grains,
hardware/buffers and monitoring paths add latency. The graph counts are resource
indicators, not a real-time performance guarantee. Extreme stage output is bounded
at ±8 before subsequent processors; final monitored/rendered output at ±0.95.
The output dynamics stage remains active during bypass.

`setOutputDevice(deviceId)` uses optional browser `AudioContext.setSinkId`; errors
are actionable when unsupported. OS routing remains available. Hardware gain,
Hi-Z/INST, pad, phantom power, Direct Monitor, Scarlett Loopback and driver buffer
size are physical/driver settings, not functioning software knobs in this catalog.
No sample-rate/device-latency figures should be labelled measured guitar latency.

## Verification

```sh
npm ci
npm run check
npm run check:rig --workspace @modulo/audio
```

Browser verification source is committed in `packages/audio/test/browser/`.
Run the main Vite app on 5173 and a separate muted Chrome debugging session on
9223; use an isolated temporary browser profile, never your signed-in profile.
The engine runner uses injected synthetic audio only. Then:

```sh
node packages/audio/test/browser/run.mjs
# Workbench on 5175:
node packages/audio/test/browser/workbench.mjs
```

The full report is written to `/private/tmp/modulo-rig-browser-report.json`.
Assertions cover actual browser rendering for every built-in effect character,
factory presets, bypass, tails, mic blending, independent parameter scheduling,
extreme EQ stacks, raw metering/tuning, snapshots/MIDI messages, failed asset
replacement, dry/wet encoder isolation, source-stop finalization/restart, stale
load cancellation, tail clearing, custom IR import and offline WAV decoding.
Synthetic checks do not establish guitar timbre, artifact acceptability, MIDI
hardware behavior, Scarlett routing, actual latency or CPU headroom. Dinnie must
listen through the real interface; Shazlin must test the integrated main UI;
Isyraf must reconcile the unchanged provider-v1 boundary before full-rig inference.
