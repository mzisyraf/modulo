# Current Tone Match flow

The user-approved main UI uses cloud model inference and a live guitar source. Browser DSP, calibration and bounded refinement still run on CPU; no local GPU is needed. Developer file-audio helpers and local workers remain available outside the public flow.

1. **Connect:** choose one interface/channel and play notes and chords during the silent ten-second calibration. Changing the device/channel invalidates calibration and the generated tone.
2. **Choose sound:** upload a permitted WAV/MP3 (10 seconds–4:55, at most 50 MiB), explicitly Prepare song, compare Song/Guitar/Backing in one player and confirm a 10–20 second passage with Use this sound. Upload selection and reference confirmation do not request tone generation.
3. **Match tone:** explicitly request individual gear settings. Automatic refinement checks the actual browser DSP without another AI request. Use this tone remains disabled until safe checks complete. Reconnected/cancelled suggestions offer Finish matching; no automatic paid retry. Application does not start live capture or playback.
4. **Play & record:** Start playing uses the calibrated interface. Effects can be bypassed. Stop all releases playing/capture/camera. Recordings default to guitar-only; Recording options exposes backing, camera and countdown. Mixed/video takes retain a separate guitar master. Download takes before refreshing or closing the tab.

The visual signal chain remains visible in Match tone and Play & record. Select a pedal/amp to open its controls; Add gear opens the library. Reorder, replace, clear, remove, Undo, export/import and custom IRs remain supported. Empty Settings/Presets pages, local/cloud selection, file calibration, supplied dry guitar, synthetic audition and backend metrics are absent from the main flow.

Full-song tabs are under Practice with full-song tabs and require an explicit Generate action. Draft accuracy/fingering limitations remain visible. Generation budgets, authentication, source validation and bounded worker behavior are unchanged.

## Verification

- `npm ci` in a clean copy, `npm run check`, `npm run check:rig --workspace @modulo/audio`.
- API regression tests from the existing API virtual environment.
- `tools/verification/guided-flow.browser.js` is the current main-UI Playwright check. Run its function through a Playwright browser runner with Vite on 5173. It intercepts every API request and supplies synthetic interface/camera media; real calibration, refinement, engine application and recording execute. It never spends cloud allowances. The test mutes actual audio output.
- Earlier main-UI browser scripts using supplied-file calibration or Generate custom rig describe the previous UI; use the guided-flow script for current acceptance. Core DSP/scorer and unit tests remain applicable.

The focused check covers explicit cloud upload, no implicit inference/capture, safe manual application, non-silent live recording, mixed camera + guitar master, Stop all cleanup, mouse Undo, tabs disclosure, channel invalidation and four mobile stage layouts. Synthetic input proves code paths, not physical guitar latency or musical similarity. A real guitar/interface listening pass remains required.
