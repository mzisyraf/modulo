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
