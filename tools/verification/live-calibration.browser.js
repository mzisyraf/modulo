// Run with Playwright against local Vite. Synthetic input only; never opens hardware capture.
async (page) => {
  const p = await page.context().newPage();
  const errors = [];
  p.on("pageerror", error => errors.push(error.message));
  const assert = (value, message) => { if (!value) throw Error(message); };
  try {
    await p.addInitScript(() => {
      window.captureMode = "tone";
      window.captureTracks = [];
      window.captureCalls = [];
      const devices = [{ kind: "audioinput", deviceId: "synthetic-interface", label: "TEST ONLY guitar interface", groupId: "test" }];
      Object.defineProperty(navigator, "mediaDevices", { value: Object.assign(new EventTarget(), {
        enumerateDevices: async () => devices,
        getUserMedia: async constraints => {
          window.captureCalls.push(constraints);
          if (window.captureMode === "denied") throw new DOMException("Test denial", "NotAllowedError");
          if (window.captureMode === "pending") await new Promise(resolve => { window.releaseCapture = resolve; });
          const context = new AudioContext();
          const source = context.createOscillator(); source.frequency.value = 220;
          const gain = context.createGain(); gain.gain.value = window.captureMode === "silence" ? 0 : .15;
          const output = context.createMediaStreamDestination();
          source.connect(gain).connect(output); source.start();
          const track = output.stream.getAudioTracks()[0];
          const stop = track.stop.bind(track);
          track.stop = () => { stop(); void context.close(); };
          track.getSettings = () => ({ channelCount: 2, sampleRate: context.sampleRate });
          window.captureTracks.push(track);
          return output.stream;
        },
      }) });
    });
    await p.goto("http://127.0.0.1:5173/");
    await p.getByRole("button", { name: /New Tone Match/ }).click();
    assert(await p.getByRole("button", { name: "Live guitar", exact: true }).getAttribute("aria-pressed") === "true", "Live input is not selected");
    assert(await p.getByRole("heading", { name: "Calibrate your guitar source" }).count() === 1, "Missing source calibration");
    await p.getByRole("button", { name: "Calibrate live guitar", exact: true }).click();
    await p.getByText("Live guitar calibrated", { exact: true }).waitFor({ timeout: 18000 });
    assert(await p.evaluate(() => window.captureTracks.every(track => track.readyState === "ended")), "Capture not released");
    assert(await p.getByText("Input level and six spectral bands measured from your playing.", { exact: true }).count() === 1, "Measurements missing");
    await p.locator("#calibration-channel").click();
    await p.locator("#calibration-channel-options").getByRole("button", { name: "Input 2", exact: true }).click();
    assert(await p.getByText("Live guitar calibrated", { exact: true }).count() === 0, "Channel change retained calibration");
    await p.evaluate(() => { window.captureMode = "denied"; });
    await p.getByRole("button", { name: "Calibrate live guitar", exact: true }).click();
    await p.getByRole("alert").filter({ hasText: "Microphone access was denied" }).waitFor();
    await p.evaluate(() => { window.captureMode = "pending"; });
    await p.getByRole("button", { name: "Calibrate live guitar", exact: true }).click();
    await p.waitForFunction(() => Boolean(window.releaseCapture));
    await p.getByRole("button", { name: "Cancel calibration" }).click();
    await p.evaluate(() => window.releaseCapture());
    await p.waitForFunction(() => window.captureTracks.length === 2 && window.captureTracks.every(track => track.readyState === "ended"));
    assert(await p.getByText("Live guitar calibrated", { exact: true }).count() === 0, "Canceled permission revived calibration");
    await p.evaluate(() => { window.captureMode = "tone"; });
    await p.getByRole("button", { name: "Calibrate live guitar", exact: true }).click();
    await p.waitForFunction(() => window.captureTracks.length === 3);
    await p.getByRole("button", { name: "Workspace", exact: true }).click();
    await p.waitForFunction(() => window.captureTracks.every(track => track.readyState === "ended"));
    assert(errors.length === 0, errors.join("; "));
    return { passed: true, checks: ["main live-input mode", "10-second PCM measurements", "track release", "channel invalidation", "denial/retry", "late-permission cancellation", "navigation cleanup"], pageErrors: errors };
  } finally { await p.close(); }
}
