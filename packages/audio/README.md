# Browser audio engine

The engine has no React or network dependency. Existing `playTestSignal()` and
`playFile(file)` return `Promise<boolean>`; `false` means a newer start/stop
canceled playback. The existing preset v1 schema, gain/drive/EQ, bypass, master
and output guard are unchanged. Cabinet, delay and reverb remain issue #5 work.

## Live input (issue #4)

This is an additive API proposal for Shazlin's frontend integration and shared
lifecycle review in #1. It does not establish human approval or rig acceptance.
There are no live-input controls in the main app yet.

```ts
import { AudioEngine } from "@modulo/audio";

const engine = new AudioEngine(validatedPreset);
engine.onEnded = () => { /* sample finished or capture track ended: update UI */ };

// Invoke directly from a user click. Use wired headphones and low volume.
const info = await engine.startLive(selectedDeviceId, 0);
if (info !== false) {
  console.log(info.settings); // actual browser settings, not requested constraints
}
// Reuse the normal controls for both live and sample audio:
engine.applyPreset(nextValidatedPreset);
engine.setBypass(true);
engine.stop(); // releases capture tracks, including permission grants arriving late
// On component/application teardown:
await engine.dispose(); // closed engines cannot restart
```

`startLive(deviceId?: string, channel = 0)` returns
`Promise<LiveInputInfo | false>`. Omit the device ID for the browser's default
input; an explicit ID uses exact device selection and does not silently fall
back to a microphone. Channel `0` is the first input, `1` the second. Other
values reject. A second channel requires the browser to report at least two
channels; otherwise it rejects and releases capture rather than silently
playing an unavailable channel. Only the chosen mono channel enters the
existing processing chain; there is no separate input-to-speaker connection.

The caller can use `navigator.mediaDevices.enumerateDevices()` and filter for
`audioinput`. Labels may be empty until permission is granted; refresh the list
after capture starts. Catch errors in the UI and keep a visible stop control:
`NotAllowedError` (permission), `NotFoundError` (missing input),
`OverconstrainedError` (unavailable exact device), and other browser capture
errors propagate unchanged. A stale canceled request resolves `false`, including
a permission rejection arriving after a newer start/stop.

The context is created/resumed from the start call. Capture requires localhost
or HTTPS and a user gesture. It requests echo cancellation, noise suppression
and automatic gain control off, plus two channels where available. Browsers
may ignore those requests: inspect `info.settings`, including `channelCount`,
`sampleRate`, `echoCancellation`, `noiseSuppression` and `autoGainControl`.
Missing settings mean unknown, not confirmed disabled. Browser APIs:
[capture settings](https://developer.mozilla.org/en-US/docs/Web/API/MediaStreamTrack/getSettings)
and [channel routing](https://developer.mozilla.org/en-US/docs/Web/API/BaseAudioContext/createChannelSplitter).

`LiveInputInfo` also contains `channel`, `trackLabel`, `contextSampleRate`, and
optional `baseLatencySeconds` / `outputLatencySeconds`. These last two values
are browser estimates, **not measured input-to-output latency**. Do not add
them and present the sum as measured round-trip latency. Do not post raw device
IDs or settings to telemetry.

Starting live input or sample playback stops the previous source. Stop/dispose
invalidate pending starts; any capture granted afterward is immediately
released without connecting it. `onEnded` fires when a sample ends naturally
or the active input track fires `ended` (for example, disconnect). Manual
stop/source replacement does not fire it. After disconnect the caller should
show a stopped state, refresh devices, and let the user explicitly restart.
Temporary track muting need not fire `ended`; hardware behavior still needs
testing. `applyPreset` and `setBypass` do not re-request capture permission.

## Real rig acceptance checklist

Automated tests use synthetic streams/fake contexts. They cannot prove real
capture, listening quality, latency, Windows drivers or interface compatibility.
Record the following on #4 once a guitar/interface and wired headphones are
available, preferably on the actual Windows demo rig:

1. Record OS, Chrome/Edge version, interface/driver, interface buffer size,
   sample rate, headphone path and whether direct monitoring is disabled.
2. Select the interface explicitly and try each physical input with matching
   channel `0`/`1`. Inspect actual capture settings and browser estimates.
3. Listen at low output: dry/sample and live must use the same preset chain;
   gain/drive/EQ and bypass must be audible. Confirm there is no second dry
   path from interface direct monitoring or other software.
4. Deny permission, retry, repeatedly start/stop, stop while permission is
   pending, switch between sample/live, unplug/reconnect, and dispose. Confirm
   the browser capture indicator goes off after stop and no duplicate playback
   remains. After reconnect require an explicit restart.
5. Measure input-to-output delay with a recorded loopback/impulse comparison.
   Record measurement routing, sample offset and sample rate, with milliseconds
   calculated as `1000 * offset_samples / sample_rate`. Repeat and report the
   measurements and range, not browser estimates as measured latency. Document
   any extra converters/routing included in the measurement.
6. Post listening notes, errors, dropouts and blockers alongside the tested
   commit. Keep #4 open until the affected humans accept actual rig evidence.

## Dry calibration capture (steps 1–3, proposed API)

This audio-package addition is for Shazlin/Isyraf integration review. It does
not add a calibration screen, identify chord names, extract source-tone
features or upload audio. A completed take stays in caller-owned memory.
Performance recording after the amp/effects remains separate future work.

Start live input using the existing user-gesture path, then explicitly capture
the selected channel:

```ts
// After a successful startLive(...), on a Record calibration click:
try {
  const take = await engine.startCalibration(10);
  // Automatically resolves after 10 audio seconds, or after finishCalibration().
  if (!take.usable) {
    // Show take.qualityFlags and ask for another dry chord take.
  } else {
    // Retain take.samples + take.sampleRate for the agreed feature-analysis path.
    // Do not upload automatically or log take.input.settings/device identifiers.
  }
} catch (error) {
  // AbortError means discard/cancel (including live stop or disconnect).
  // Other errors should offer a retry; attach this handler immediately.
}

// From a separate Finish button; leaves live monitoring active:
engine.finishCalibration();
// From Discard; rejects the pending startCalibration promise with AbortError:
engine.cancelCalibration();
```

`startCalibration(maxSeconds = 10): Promise<CalibrationTake>` requires active
live input and permits one pending take. Duration must be finite and between
2 and 15 seconds. It loads a bundled AudioWorklet and records the chosen mono
channel **before** the app's input gain, drive, EQ and output processing. This
cannot undo processing already applied by hardware or the capture driver.
The worklet outputs silence, so it adds no second dry monitoring path.

The take contains:

- `samples`: owned mono `Float32Array` PCM, with no gain normalization applied.
- `sampleRate`: the audio-context rate (the browser may resample the interface).
- `durationSeconds`: actual captured sample count divided by that rate.
- `input`: snapshot of the live channel, capture settings and context/latency
  diagnostics. Device identifiers in settings stay local.
- `level`: linear full-scale `peak`, `rms` and `clipping` boolean.
- `qualityFlags` and `usable`: local input-quality heuristics. `too_short`
  means less than 2 seconds; `silence` means overall RMS below 0.001 (−60 dBFS);
  `clipping` means any sample's magnitude is at least 0.99; `invalid_samples`
  means non-finite input was detected (replaced by zero in returned PCM).
  Any flag makes `usable` false. These are conservative draft thresholds for
  rig review, not calibrated confidence, proof of a guitar, named chord
  recognition, spectral features or proof that a full exercise was played.

The frame count is capped on both the audio thread and main thread. Explicit
finish flushes queued PCM before resolving; it may produce a flagged short
take. Finishing before processor setup completes cancels with AbortError.
Cancel works during module loading as well as capture. Live stop, replacing
the source/channel, disconnect's `ended` event or engine disposal cancels the
pending take. Completion/finish releases the recorder nodes/port and leaves
live input running. If the context stalls, capture rejects after the requested
duration plus five wall-clock seconds rather than waiting indefinitely.
Cancellation and completion do not invoke `onEnded`; that callback still
describes the source's lifecycle.

For a visible level check, poll `engine.getInputLevel(): InputLevel | null`
using `requestAnimationFrame` while the live view is visible. It reads the
selected dry input's most recent 2048 samples; `null` means no active live
input. Use `20 * Math.log10(Math.max(value, 1e-8))` if the UI needs dBFS.
This meter is a recent snapshot, not a retained peak history or a level-setting
control. It does not change the signal. Stop polling on view teardown.

Shazlin should expose Record / Finish / Discard / Retry with separate recording
state and catch the capture promise immediately. Clear old accepted takes when
the device/channel or physical input gain changes; ask the user to recalibrate
after guitar/pickup changes. The engine cannot detect physical gain or guitar
changes. Since the engine does not retain completed takes, the caller owns
discarding old arrays and deciding when a baseline is accepted. Existing Stop
and navigation cleanup already call `engine.stop()` and will cancel capture.
Isyraf should agree a versioned source-feature/transport contract before
depending on this local PCM shape as a server API. No preset-schema changes
are needed to use this capture API.

## Offline preset evaluation

`await AudioEngine.renderFile(file, preset)` renders the same initialized gain/drive/EQ/master/output-guard graph into an AudioBuffer without opening a speaker context or requesting capture. It is static and does not stop or mutate an existing live engine. Input must be nonempty, <=20MiB, mono/stereo and 0.1–90s; decode runs at 44.1kHz. Schema validation is unchanged. Offline disposal skips the realtime-only close method; playback/live initialization and smoothing retain their existing behavior. This API does not supply a separate amp/cab model or establish perceptual accuracy. The paired/held-out pipeline is documented in ../../docs/PRESET_EVALUATION.md.

`setListeningGains(originalDb, processedDb)` sets transient dry/wet route gains in [-48,+48]dB, default0dB. Gain sits after effects/bypass split and before existing master/output protection, so independent fades avoid a shared-gain jump during A/B switching. It is for opt-in file audition only; no preset schema control is added. Default playback/live/rendered graph behavior is unchanged. `renderFile(file,preset,bypass=false)` also permits the true bypass route for measuring dry listening levels. Future recorder integration must deliberately decide whether monitoring compensation belongs in a recording; current shared live controls never set these gains.

## Processed performance recorder (step 10, proposed API)

The engine can encode its active live or sample source after input gain,
drive/EQ/bypass, master gain and output protection. It connects only that
protected output to a private `MediaStreamAudioDestinationNode` and native
`MediaRecorder`. It never records the raw microphone stream, page/system
audio, song/reference players or backing tracks. The normal headphone route
is preserved. Whatever input the user selected is processed; the engine cannot
determine whether that source is actually a guitar.

This is the audio half for Shazlin's existing recording library. Its controls
still need frontend wiring/review; no app UI changes are included here.

```ts
// After starting live input or a dry-sample audition, on a Record click:
try {
  const take = await engine.startPerformanceRecording();
  // Pass take directly to apps/web's createPerformanceRecording(take, details).
  // It contains blob, durationSeconds, mimeType, sampleRate and stopReason.
} catch (error) {
  // AbortError = discarded; other errors need visible retry guidance.
  // Attach this handler immediately, including when navigating away.
}

// From a separate Finish button; resolves the original start promise:
engine.finishPerformanceRecording(); // does not stop live monitoring
// Discard instead:
engine.cancelPerformanceRecording(); // rejects original promise with AbortError
```

`startPerformanceRecording({ maxSeconds?, maxBytes? }?)` requires an active
engine source and running context. Defaults/hard upper limits are 180 seconds
and 50 MiB, matching the library. Positive smaller limits may be supplied.
Only one recording or finalization may run at once. The promise resolves only
after the final encoded chunk arrives; do not create a Blob from intermediate
chunks, or create a second raw-input recorder in the frontend.

`PerformanceTake` has a playable audio `blob`, actual encoded `mimeType`,
`durationSeconds` from the audio-context clock, processing-context `sampleRate`,
and `stopReason`: `manual`, `duration_limit` or `source_stopped`. The codec may
use a different internal sample rate and add padding; the processing rate and
active recording duration are not an inspection of encoded file headers.
WebM/Opus, Ogg/Opus and MP4 are considered in that order if supported; otherwise
the browser's default is tried. Unsupported/empty/non-audio results reject.
Use the returned MIME type rather than assuming WAV/MP3 or changing the file
extension. Blob audio is not normalized or uploaded.

`getPerformanceRecordingState()` is `idle`, `recording` or `stopping`. Stop and
source replacement (including live device/channel switches), natural sample
end and live track-ended finalize with `source_stopped`. `dispose()` discards
pending recording. Cancel discards any buffered chunks. The engine releases
the encoder destination/tracks and handlers without stopping live capture on
normal Finish. Do not use `onEnded` to detect recording completion: it still
describes the input source; the recording promise describes file completion.

The duration timer stops slightly early for scheduling margin. Delayed timers
that produce an overlong take cause rejection/discard, not a falsified capped
duration. A size overflow, including the final chunk, discards the whole take
rather than returning a corrupt partial container. Finalization has a five
second timeout. Native encoders can buffer internally, so timeslices are not
an exact memory or duration clock. Keep the tab active while recording.

Frontend integration: retain a separate capture/session token, show Recording
then Finalizing until the start promise settles, prevent duplicate starts,
and handle auto-duration/source stops as completed takes. On Discard/new
project/unmount, cancel explicitly and invalidate stale promise handlers so
a finished take is not attached to a different project. Decide whether ordinary
navigation should finalize/save or discard; current `engine.stop()` finalizes,
while disposal discards. Snapshot project/preset metadata at start (or label
changed controls as an edited take). Keep the 12-take library/Blob URL lifecycle
in apps/web; the engine does not store completed takes or create object URLs.
Dry calibration and performance capture remain separate types/routes.

Synthetic decoded-file checks establish routing and lifecycle, not actual
guitar timbre, recording quality on every browser or hardware latency. The
reported live Drive crackling remains unresolved and is not changed by this
recorder. Real Scarlett/Edge recording and downloaded-file listening still
require human verification.
