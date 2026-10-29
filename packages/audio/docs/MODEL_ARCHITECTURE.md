# Model-specific gear: architecture and reference study

This increment replaces category-owned UI knobs with explicit, versioned model
definitions. It is not a circuit-emulation or captured-hardware claim. Initial
algorithms are original browser DSP, including existing approximation models.

## Boundaries

1. A model registry owns stable model/parameter IDs, category, version, labels,
   value types, physical ranges/defaults/units, display scaling, control widgets,
   choices, visibility conditions and DSP bindings. Each model lists its own
   parameters explicitly. A category is navigation, not a knob schema.
2. A processor factory ID selects the actual implementation. Native Web Audio
   and AudioWorklet are the implemented backends. Faust/WASM and WAM are future
   adapters, not installed runtimes or claimed plugin-host support.
3. The existing category catalog remains a **legacy DSP wire format** for
   `RigPreset` v1. Model-specific parameter/state helpers validate the selected
   model and map its parameters into that format. Existing saved presets retain
   all their legacy values, including controls not exposed by the new model UI.
   No lossy automatic conversion of old presets. Non-default hidden legacy
   adjustments are disclosed with an explicit reset action. Model changes create the new
   model's defaults, retaining instance ID and bypass, then clean incompatible
   snapshot/CC fields. Shared provider `Preset` v1 is untouched.
4. React reads the selected model's descriptors and values to render knobs,
   switches/toggles, dropdowns and numeric/file-asset controls. Widgets never
   invent DSP parameters. UI normalization is separate from DSP unit conversion.
   The main React view and workbench use the same renderer and AudioEngine.
5. A parameter change is validated against its model before reaching the audio
   graph. Native parameters use existing smoothing and scheduling. Structural
   controls rebuild through the existing validated graph swap; worklet controls
   remain bounded block messages. No React, allocation-heavy compilation, network
   or file decoding runs in the audio callback.
6. Bypass, ordering, parallel paths, snapshots, MIDI, dry/wet recording and
   offline rendering reuse the existing engine. Presets save/load through the
   established rig serializer; model identity/version changes must preserve a
   migration path rather than silently reinterpreting existing IDs.

Initial verified examples span distinct categories: an original linear studio
preamp, existing nonlinear amp/pedal approximations with different controls,
single-tap slapback versus filtered-feedback/stereo delay, and a complementary
tilt EQ. Further catalog entries are introduced only with an implementation,
parameter binding and audible/numerical test. A smaller model can expose fewer
controls; this is intentional, not a hidden generic panel.

## Reference study and licences (29 October 2026)

These pinned primary sources were inspected for architecture, declarations and
implementation patterns. **No external code, coefficient tables, DSP binaries,
GUI images, presets, IRs or model weights are incorporated in this increment.**
The project licence/publication decision is unchanged. Licence observations
below apply to the inspected files, not blanket clearance of all dependencies.

| Reference / inspected revision | Findings used as architectural reference | Licence observation |
| --- | --- | --- |
| [0xFX](https://github.com/averagenative/0xFX/tree/5b248779c96dce6e64d0ed29cfa598014dc4d3c4) | `src/engine/fx_engine.h`, `internal/amp.c`, `internal/pedals.c`: model/type IDs, per-instance state, subsets of amp controls and per-pedal dispatch. Its normalized parameter convention is an internal convention, not evidence of physical hardware knobs. | [Root LICENSE](https://github.com/averagenative/0xFX/blob/5b248779c96dce6e64d0ed29cfa598014dc4d3c4/LICENSE): MIT. Bundled dependency/assets licences are separate. No copying here. |
| [GxPlugins.lv2](https://github.com/brummer10/GxPlugins.lv2/tree/19df03e5e1be1a97bf3c60c66a0d3f830c0f35b9) | This is a submodule collection. Inspected pinned [GxSD1](https://github.com/brummer10/GxSD1.lv2/tree/3e0fe8c017d97d60593ae8d80c68cf50f909589f), its LV2 ports and `dsp/sd1sim.cc`: concrete model-specific port definitions belong alongside the actual processor. | Collection and GxSD1 root LICENSE files contain GPL v3; GxSD1 Turtle metadata also declares an ISC URI. These file-level observations are not blanket clearance; no source was copied. |
| [Guitarix](https://github.com/brummer10/guitarix/tree/666b564bb8a7194f200029fdbfbec2abe035f777) | Parameter-table registration, `coverd.dsp` controls and Tube Delay's explicit level/feedback/time/output with filtered feedback illustrate metadata tied to algorithms, not generic effect labels. Large generated circuit coefficients are not browser-ready drop-ins. | [COPYING](https://github.com/brummer10/guitarix/blob/666b564bb8a7194f200029fdbfbec2abe035f777/trunk/COPYING) explains GPL2+ original code and GPL3+/LGPL3+ components, conveyed as GPL3+ overall. Not incorporated. |
| [Faust libraries](https://github.com/grame-cncm/faustlibraries/tree/4b8961b03ff90f5457724d987d14703d960ec30b) | Inspected `compressors.lib` and `filters.lib`: reusable DSP primitives, smoothing and explicit algorithm composition. A library primitive still needs bounded model controls and integration tests. | Inspected headers contain LGPL2.1-or-later and a generated-code exception. This is file-specific; the exception does not automatically cover every imported library/compiler/runtime/asset. No compiled Faust added. |
| [FaustWasm](https://github.com/grame-cncm/faustwasm/tree/860a4b3582975bd1adfc75732737d920a8a76919) | `FaustDspGenerator.ts` and `FaustAudioWorkletNode.ts`: metadata-driven UI, parameter paths, worklet creation, timed changes and explicit destruction are a future backend adapter pattern. Compile/load off the audio thread. | [COPYING.txt](https://github.com/grame-cncm/faustwasm/blob/860a4b3582975bd1adfc75732737d920a8a76919/COPYING.txt): LGPL2.1-or-later. Runtime/compiler/generated DSP distribution needs its own review; no dependency installed. |
| [Web Audio Modules API](https://github.com/webaudiomodules/api/tree/ea39fccecc57db352980ac36bcd7ea8ae4de25e0) | `src/types.d.ts`: parameter discovery, typed ranges/defaults/choices/exponent/units, normalized values, state, scheduled events and destroy. Our metadata is inspired by these concepts, not a claim to implement the WAM ABI. | `package.json` declares MIT; no standalone root licence file appeared in the inspected tree. Not vendored or installed. |
| [MOD LV2 data](https://github.com/mod-audio/mod-lv2-data/tree/4f7ed85f61e94514fd7703d74dae7f3e5df83774) | Inspected Guitar_AmpCabVerbStereo pedalboard routing/state and ChowCentaur Turtle port metadata: instance connections and state should be distinct from model definitions; ports carry symbols/ranges/types. | No repository-wide root licence grant found. Bundles, metadata, modgui artwork and presets require individual provenance/licence review. No assets/data copied. |

The references inform structure, not hardware authenticity. Authentic circuit
modelling requires a corresponding validated processor and reference evidence;
captures require licensed capture assets and a separate runtime/parameter model.
No TONEX/NAM/capture capability follows from adding names or knobs.

## Acceptance for an incremental model

- Unique stable ID/version and explicit supported descriptors; unknown controls
  and invalid values reject without altering the audible state.
- Each exposed control maps to an implemented parameter and is tested in its
  relevant operating mode (for example tempo division while sync is enabled).
- Two models in one category can have different parameter IDs, counts, widgets,
  mappings and processor factories. Changing a model cannot leak stale controls.
- Rendered tests cover finite output, meaningful response, bypass, persistence,
  real-time changes and lifecycle. Browser timing estimates are not measured
  guitar latency; synthetic tests are not musical/hardware approval.
- Licence/provenance and approximation labels remain attached to the model.

## Implemented first increment

`getGearModels(category?)` / `getGearModel(id)` expose 57 explicit model
definitions across the 14 categories. Most use the existing tested processor
adapters, now with deliberate model-owned parameter lists and mappings. Three
new original factories are independently implemented: `native.studio-clean.v1`,
`native.single-tap.v1`, `native.tilt-eq.v1`. This is an incremental foundation,
not a claim that 57 hardware devices have been reproduced or independently
musically verified. New models require a factory or a reviewed existing adapter.

Examples of different controls in one category:

- Studio Clean Preamp: Volume, Bass, Treble, Bright. Linear two-band processing,
  no Gain/Presence/Resonance knobs or nonlinear stage.
- Modern High Gain: Gain, Bass, Middle, Treble, Presence, Resonance, Master,
  Bright. Existing oversampled nonlinear processing.
- Gold Distortion+ approximation: Distortion and Output. Rodent approximation:
  Distortion, Filter, Volume; Filter reverses the legacy tone mapping so larger
  values darken the processed signal. These are not copied circuit algorithms.
- Single Tap: Time and Mix, one feed-forward echo. Digital Delay: Time,
  Feedback, Mix, Sync and conditional Note Division; its feedback graph remains
  distinct. Tilt EQ: Tilt and Pivot instead of a generic parametric-EQ panel.

```ts
import { getGearModels, modelFor, modelValues, createGearModule } from "@modulo/audio";
const pedal = createGearModule("distortion.gold", "pedal_1");
const info = modelFor(pedal); // versioned descriptors; exactly two controls
const ownValues = modelValues(pedal);
// Add pedal to an existing validated rig and apply it through the same engine.
await engine.setModelParameter("pedal_1", "distortion", 0.4);
// Numeric model-owned targets also map into the existing MIDI/automation path:
engine.learnModelMidi("pedal_1", "distortion", 0.1, 0.8);
```

`parseModelState` rejects extra/missing/wrong-type controls. Parameter mapping is
validated twice: against the selected model and against the existing DSP wire
bounds. Display normalization (linear/log/power) never changes the serialized
wire units. `setModelParameter(..., atTime?)` supports existing native scheduling;
structural controls rebuild immediately and reject future timing. No unused
controls are exposed merely because a backend category has a compatibility slot.

The shared `apps/web/src/ModelControls.tsx` renderer contains no family-specific
knob arrays. Knobs support captured pointer drags and native keyboard ranges;
switches, toggles, dropdowns and asset choices use the same descriptors. The main
Tone Match page reuses its existing `AudioEngine` through `ModelRigPanel`.
The workbench retains its horizontal gear library and drag/drop editor, using
the same React controls. Neither path creates a second monitoring/capture graph.

Use the main app's **Use model rig** button, then its existing audition/live
input controls. **Use demo preset** restores the previous v1 path. The legacy
editor is disabled while model mode is active. Rig JSON download/import and
tab-local projects retain active rig DSP state; save unapplied draft edits as
JSON before leaving the editor. Custom IR bytes remain separately loaded in
the engine's bounded in-memory library; the explicit IR ID allows matching
an imported preset's asset reference. Missing asset IDs are displayed, not hidden.
Model changes clear old
snapshot values/incompatible mappings, while plain legacy import remains lossless.

Validation sources are committed under `packages/audio/test/`:

```sh
npm ci
npm run check
npm run check:rig --workspace @modulo/audio
# With local Vite on 5173 and isolated muted Chrome debugging on 9223:
MODULO_AUDIO_SUITE=models node packages/audio/test/browser/run.mjs
node packages/audio/test/browser/model-ui.mjs
# With the workbench on 5175:
node packages/audio/test/browser/workbench.mjs
```

The model suite probes every exposed control in ten initial model examples,
with relevant operating conditions enabled, plus distinct echo topology,
preamp linearity and strict model API/MIDI/state/lifecycle behavior. Other
legacy entries have rendered-processor regression coverage, not exhaustive
new per-control or hardware measurements. React checks cover model schemas,
mouse/keyboard knobs, persistence, model bypass/reorder, project changes,
legacy-mode restoration and narrow layout. No Scarlett feedback fix, measured
round-trip latency, Faust/WASM/WAM runtime, circuit authenticity or capture-based
model is claimed. Integrating the pending Isyraf changes remains a separate,
coordinated merge/retest with affected-owner review.
