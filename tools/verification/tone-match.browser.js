// Run with Playwright browser_run_code_unsafe(filename=...). All API/audio data is TEST ONLY.
async (page) => {
  page = await page.context().newPage();
  const checks = [];
  const errors = [];
  page.on("pageerror", (error) => errors.push(error.message));
  const check = (ok, label) => { if (!ok) throw new Error(label); checks.push(label); };
  const jobs = new Map();
  let uploads = 0, generations = 0, enabled = true, failGeneration = false, lastBackend = "local", holdJob = false;
  let heldResult;
  const preset = {
    schema_version: "1", name: "TEST ONLY injected preset", description: "Synthetic browser regression; no model inference.",
    provenance: { kind: "generated", provider: "nebius", model: "TEST ONLY" },
    quality_flags: ["source_calibration_missing", "target_energy_only", "tone_matching_unverified"],
    parameters: { input_gain_db: -3, drive: 0.2, bass_db: 1, mid_db: 0, treble_db: 2, master_gain_db: -18 },
  };
  const wav = Buffer.alloc(44 + 44100 * 2 * 12);
  wav.write("RIFF"); wav.writeUInt32LE(wav.length - 8, 4); wav.write("WAVEfmt ", 8);
  wav.writeUInt32LE(16, 16); wav.writeUInt16LE(1, 20); wav.writeUInt16LE(1, 22);
  wav.writeUInt32LE(44100, 24); wav.writeUInt32LE(88200, 28); wav.writeUInt16LE(2, 32);
  wav.writeUInt16LE(16, 34); wav.write("data", 36); wav.writeUInt32LE(wav.length - 44, 40);
  for (let i = 0; i < 44100 * 12; i++) wav.writeInt16LE(Math.round(1000 * Math.sin(i * 2 * Math.PI * 220 / 44100)), 44 + i * 2);
  await page.addInitScript(() => {
    if (window.__toneMatchInstrumented) return;
    window.__toneMatchInstrumented = true;
    window.__contexts = []; window.__shapers = []; window.__micRequests = 0;
    const connect = AudioNode.prototype.connect;
    AudioNode.prototype.connect = function(destination, ...args) {
      if (destination instanceof AudioDestinationNode && !(this.context instanceof OfflineAudioContext)) {
        const mute = this.context.createGain(); mute.gain.value = 0;
        connect.call(mute, destination); connect.call(this, mute, ...args); return destination;
      }
      return connect.call(this, destination, ...args);
    };
    const Native = window.AudioContext;
    window.AudioContext = class extends Native {
      constructor(...args) { super(...args); window.__contexts.push(this); }
      createWaveShaper() { const node = super.createWaveShaper(); window.__shapers.push(node); return node; }
    };
    Object.defineProperty(navigator, "mediaDevices", { value: Object.assign(new EventTarget(), {
      enumerateDevices: async () => [{kind:"audioinput",deviceId:"test-interface",label:"TEST ONLY instrument"}],
      getUserMedia: async () => {
        window.__micRequests++;
        const context = new Native();
        const source=context.createOscillator(), gain=context.createGain(), output=context.createMediaStreamDestination();
        source.frequency.value=window.__testFrequency ?? 220; gain.gain.value=.1;
        source.connect(gain).connect(output); source.start();
        const track=output.stream.getAudioTracks()[0], stop=track.stop.bind(track);
        track.stop=()=>{stop();void context.close();};
        return output.stream;
      },
    }) });
  });
  await page.unroute("**/api/**");
  await page.route("**/api/**", async (route) => {
    const request = route.request(), url = new URL(request.url()), method = request.method();
    const json = (value, status = 200) => route.fulfill({ status, contentType: "application/json", body: JSON.stringify(value) });
    if (url.pathname === "/api/health") return json({ status: "ok", mode: "scaffold", separation_available: true, preset_generation_available: enabled });
    if (url.pathname === "/api/jobs" && method === "POST") {
      uploads++;
      lastBackend = request.headers()["x-separation-backend"] ?? "local";
      const id = `11111111-1111-4111-8111-${String(uploads).padStart(12, "0")}`;
      jobs.set(id, { job_id: id, backend: lastBackend, status: holdJob ? "running" : "ready", stage: "ready", expires_at: Date.now() / 1000 + 3600,
        result: { duration_seconds: 12, sample_rate: 44100, common_gain_linear: 1,
          provenance: { kind: lastBackend === "modal" ? "cloud_separation" : "local_separation", ...(lastBackend === "modal" ? { provider: "modal" } : {}), model: "TEST ONLY", device: "Synthetic test" },
          artifacts: Object.fromEntries(["mix", "guitar", "backing"].map((name) => [name, `/api/jobs/${id}/audio/${name}`])),
          reference: null, reference_revision: 0, suggestion: null, quality_flags: ["separation_quality_unverified"] } });
      if (holdJob) { heldResult = jobs.get(id).result; delete jobs.get(id).result; }
      return json({ job_id: id, status: "queued" }, 202);
    }
    const [, id, action] = url.pathname.match(/^\/api\/jobs\/([^/]+)(?:\/(.*))?$/) ?? [];
    const job = jobs.get(id);
    if (!job) return json({ error: { message: "TEST ONLY expired job" } }, 404);
    if (action === "references") return json({ method: "signal_contrast_v1", duration_seconds: 12,
      options: [{ start_seconds: 0, end_seconds: 12, label: "TEST ONLY passage", explanation: "Synthetic suggestion", quality_flags: ["tone_difference_unverified"] }],
      waveforms: { mix: Array(240).fill(.2), guitar: Array(240).fill(.1) } });
    if (action?.startsWith("audio/")) return route.fulfill({ contentType: "audio/wav", body: wav });
    if (action === "reference" && method === "POST") {
      job.result.reference = { ...request.postDataJSON(), quality_flags: ["separation_quality_unverified"], explanation: "TEST ONLY selected passage" };
      job.result.reference_revision++; delete job.generation;
      return json(job.result.reference);
    }
    if (action === "preset" && method === "POST") {
      generations++;
      const source = request.postDataJSON().source_calibration;
      check(source?.method === "browser_level_v1" && source.duration_seconds >= 3 && source.tone_features?.bands.length === 6, "generation receives live level and spectral measurements");
      const calibrated = source ? { ...preset, quality_flags: source.tone_features?["source_level_calibrated","spectral_features_measured","tone_matching_unverified"]:["source_level_calibrated", "spectral_calibration_missing", "target_energy_only", "tone_matching_unverified"], parameters: { ...preset.parameters, input_gain_db: Math.round(Math.max(-24, Math.min(12, -24 - source.rms_dbfs, -6 - source.peak_dbfs)) * 10) / 10 } } : preset;
      job.generation = { request_id: `22222222-2222-4222-8222-${String(generations).padStart(12, "0")}`, reference_revision: job.result.reference_revision,
        ...(source ? { source_calibration: source } : {}),
        ...(source?.tone_features?{target_tone_features:source.tone_features,target_rms_dbfs:source.rms_dbfs}:{}),
        status: failGeneration ? "failed" : "ready", ...(failGeneration ? { error: { code: "test_error", message: "TEST ONLY provider failure", retryable: false } } : { preset: calibrated }) };
      return json(job.generation, 202);
    }
    return json(job);
  });
  let calibrations = 0;
  async function calibrate() {
    await page.getByRole("button", {name: /Calibrate live guitar|Calibrate again/, exact:true}).click();
    await page.getByText("Live guitar calibrated", {exact:true}).waitFor({timeout:18000});
    calibrations++;
    await page.evaluate(() => { window.__contexts=window.__contexts.filter(c=>c.state!=="closed"); window.__shapers=[]; });
  }
  await page.goto("http://127.0.0.1:5173");
  await page.getByRole("button", { name: "Tone Match", exact: true }).click();
  check(await page.getByText("Local or Cloud API separation", { exact: true }).isVisible(), "main Tone Match uses real API workflow");
  check(await page.getByLabel("Demo result").count() === 0, "fixture stage controls removed");
  await calibrate();
  await page.getByLabel("Mixed-song audio", { exact: true }).setInputFiles({ name: "test-only.wav", mimeType: "audio/wav", buffer: wav });
  await page.getByRole("button", { name: "Separate guitar", exact: true }).dblclick();
  await page.getByRole("heading", { name: "Compare the same passage" }).waitFor();
  check(uploads === 1, "duplicate upload starts one job");
  await page.getByRole("button", { name: "Confirm reference", exact: true }).click();
  await page.getByText("Reference confirmed:", { exact: false }).waitFor();
  await page.getByRole("button", { name: "Generate starting preset", exact: true }).click();
  await page.getByRole("button", { name: "Apply starting preset", exact: true }).waitFor();
  check(await page.locator("#amp-title").innerText() !== preset.name, "generation does not auto-apply");
  check(await page.evaluate(() => window.__contexts.length) === 0, "generation creates no audio graph or autoplay");
  await page.getByRole("button",{name:"Check rendered tone",exact:true}).click();
  await page.getByText("Feature difference: rig",{exact:false}).waitFor();
  check(await page.evaluate(()=>window.__contexts.length)===0,"quality check renders offline without audible context");
  await page.getByRole("button", { name: "Apply starting preset", exact: true }).click();
  check(await page.locator("#amp-title").innerText() === preset.name, "Apply reaches shared amp");
  check(await page.locator("#drive").inputValue() === "0.2", "shared controls reflect generated values");
  check(await page.getByRole("button", { name: "Play test signal", exact: true }).count() === 1, "embedded panel has no second audition owner");
  await page.getByRole("button", { name: "Play test signal", exact: true }).click();
  await page.waitForFunction(() => window.__contexts.length === 1 && window.__shapers.length === 2);
  const beforeCurve = await page.evaluate(() => Array.from(window.__shapers[0].curve));
  await page.locator("#drive").fill("0.8");
  const afterCurve = await page.evaluate(() => Array.from(window.__shapers[0].curve));
  check(afterCurve.some((v, i) => v !== beforeCurve[i]), "real shared engine receives edits");
  await page.getByRole("button", { name: "Play backing passage", exact: true }).click();
  await page.waitForFunction(() => !document.querySelector('audio[aria-label="Guitar-reduced backing"]').paused);
  check(await page.getByText("Playing synthetic test signal", { exact: true }).count() === 0, "backing stops amp without pausing itself");
  await page.getByRole("button", { name: "Workspace", exact: true }).click();
  check(await page.evaluate(() => [...document.querySelectorAll("audio")].every((a) => a.paused)), "navigation pauses every player");
  await page.getByRole("button", { name: "Tone Match", exact: true }).click();
  check(await page.locator("#amp-title").innerText() === preset.name, "navigation preserves current preset/job");
  await page.getByRole("button", { name: "Workspace", exact: true }).click();
  await page.getByRole("button", { name: "New Tone Match", exact: false }).click();
  check(await page.getByRole("heading", { name: "Compare the same passage" }).count() === 0, "new project starts without old job");
  await page.getByRole("button", { name: "Workspace", exact: true }).click();
  await page.getByRole("button", { name: "Open project", exact: true }).click();
  await page.getByRole("heading", { name: "Compare the same passage" }).waitFor();
  check(await page.locator("#amp-title").innerText() === preset.name, "saved project reconnects to its own job and preset");
  await page.getByRole("button", { name: "Manual selection", exact: true }).click();
  await page.locator("#reference-end").fill("11");
  check(await page.getByRole("button", { name: "Apply starting preset", exact: true }).count() === 0, "changed bounds remove stale proposal");
  check(await page.locator("#amp-title").innerText() !== preset.name, "changed bounds invalidate applied generated preset");
  await calibrate();
  await page.getByRole("button", { name: "Confirm reference", exact: true }).click();
  await page.getByRole("button", { name: "Generate starting preset", exact: true }).waitFor();
  failGeneration = true;
  await page.getByRole("button", { name: "Generate starting preset", exact: true }).click();
  await page.getByText("TEST ONLY provider failure", { exact: false }).waitFor();
  check(await page.getByRole("heading", { name: "Compare the same passage" }).isVisible(), "provider failure retains separated audio");
  failGeneration = false;
  await page.getByRole("button", { name: "Retry generation", exact: true }).click();
  await page.getByRole("button", { name: "Apply starting preset", exact: true }).waitFor();
  check(generations === 3, "generation retry is deliberate");
  await page.getByRole("button", { name: "Recordings", exact: true }).click();
  check(await page.getByRole("heading", { name: "No performance recordings yet" }).isVisible(), "recordings library remains available");
  await page.getByRole("button", { name: "Tone Match", exact: true }).click();
  check(await page.getByRole("button", { name: "Record", exact: true }).count() === 1, "performance recording controls preserved");
  check(await page.evaluate(() => window.__micRequests) === calibrations, "integration never requests microphone automatically");
  check(await page.evaluate(() => window.__contexts.length) === 1, "one audio context across jobs, projects and navigation");
  await page.setViewportSize({ width: 390, height: 844 });
  check(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), "narrow layout has no horizontal overflow");
  await page.screenshot({ path: "data/verification/tone-match-narrow.png", fullPage: true });
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.screenshot({ path: "data/verification/tone-match-desktop.png", fullPage: true });
  await page.getByRole("button", { name: "Apply starting preset", exact: true }).click();
  jobs.clear();
  await page.getByRole("button", { name: "Reconnect preset status", exact: true }).click();
  await page.getByText("This job is missing or expired.", { exact: false }).waitFor();
  check(await page.locator("#amp-title").innerText() !== preset.name, "known job expiry invalidates the shared preset");
  enabled = false;
  await page.getByLabel("Mixed-song audio", { exact: true }).setInputFiles({ name: "disabled-test.wav", mimeType: "audio/wav", buffer: wav });
  await page.getByRole("button", { name: "Separate guitar", exact: true }).click();
  await page.getByRole("heading", { name: "Compare the same passage" }).waitFor();
  await page.getByRole("button", { name: "Confirm reference", exact: true }).click();
  await page.getByText("Generation is disabled:", { exact: false }).waitFor();
  check(await page.getByRole("button", { name: "Generate starting preset", exact: true }).isDisabled(), "zero allowance keeps main generation disabled");
  await page.getByRole("button", { name: "Cloud API", exact: true }).click();
  check(await page.getByRole("button", { name: "Cloud API", exact: true }).getAttribute("aria-pressed") === "true", "cloud backend is explicitly selected");
  check(await page.getByRole("heading", { name: "Compare the same passage" }).count() === 0, "changing backend clears the old result");
  await page.getByLabel("Mixed-song audio", { exact: true }).setInputFiles({ name: "cloud-test.wav", mimeType: "audio/wav", buffer: wav });
  holdJob = true;
  await page.getByRole("button", { name: "Separate guitar", exact: true }).click();
  // Unfinished jobs cannot expose results; hold the fixture briefly to inspect disabled controls.
  await page.getByText("Running Cloud API guitar separation", { exact: false }).waitFor();
  const latestJob = [...jobs.values()].at(-1);
  check(await page.getByRole("button", { name: "Local", exact: true }).isDisabled(), "backend cannot change while cloud job runs");
  latestJob.result = heldResult; latestJob.status = "ready";
  await page.getByRole("heading", { name: "Compare the same passage" }).waitFor();
  check(lastBackend === "modal", "Cloud API upload selects the cloud backend without browser credentials");
  check(await page.getByText("Cloud API separation ready", { exact: false }).isVisible(), "cloud result is labelled honestly");
  await page.getByRole("button", { name: "Local", exact: true }).click();
  check(await page.getByRole("heading", { name: "Compare the same passage" }).count() === 0, "returning to Local clears cloud artifacts");
  check(errors.length === 0, `no page errors: ${errors.join("; ")}`);
  await page.unroute("**/api/**");
  return { synthetic: true, checks, uploads, generations, errors };
}
