// PAID: one new Modal job and one Token Factory request. Requires explicit root-page authorization.
// Runs the production build on4173, preserving a stable session while development tools run on5173.
async (page) => {
  if (!await page.evaluate(() => window.__approvePaidRigFlow === true)) throw Error("Explicit approved spending authorization required.");
  await page.evaluate(() => { delete window.__approvePaidRigFlow; });
  if (page.context().pages().some(p => p.url().includes("overnight=production-flow"))) throw Error("Inspect the existing production attempt instead of starting another paid job.");
  const p = await page.context().newPage(), checks = [], errors = [], started = Date.now();
  const check = (value, message) => { if (!value) throw Error(message); checks.push(message); };
  p.on("pageerror", error => errors.push(error.message));
  await p.addInitScript(() => {
    window.__micRequests = 0; window.__testMutes = [];
    const capture = navigator.mediaDevices.getUserMedia.bind(navigator.mediaDevices);
    navigator.mediaDevices.getUserMedia = (...args) => { window.__micRequests++; return capture(...args); };
    window.__originalConnect = AudioNode.prototype.connect;
    AudioNode.prototype.connect = function(destination, ...args) {
      if (destination instanceof AudioDestinationNode && !(this.context instanceof OfflineAudioContext)) {
        const mute = this.context.createGain(); mute.gain.value = 0; window.__testMutes.push(mute);
        window.__originalConnect.call(mute, destination); return window.__originalConnect.call(this, mute, ...args);
      }
      return window.__originalConnect.call(this, destination, ...args);
    };
    window.__originalPlay = HTMLMediaElement.prototype.play;
    HTMLMediaElement.prototype.play = function() { this.muted = true; return window.__originalPlay.call(this); };
  });
  const code = await (await p.request.get("http://127.0.0.1:5173/src/StartingPresetPanel.tsx")).text();
  const module = code.match(/import\s*\{\s*AudioEngine\s*\}\s*from\s*["']([^"']+)["']/)?.[1];
  if (!module) throw Error("Cannot locate the known licensed test fixture.");
  const root = module.split("/packages/audio/")[0];
  const songResponse = await p.request.get(`http://127.0.0.1:5173${root}/data/bench/kevin-macleod-exhilarate/Exhilarate-first-60s.wav`);
  if (!songResponse.ok()) throw Error("Licensed music fixture is unavailable.");
  const song = await songResponse.body(); let id;
  p.on("response", async response => { if (new URL(response.url()).pathname === "/api/jobs" && response.request().method() === "POST" && response.ok()) id = (await response.json()).job_id; });
  await p.goto("http://127.0.0.1:4173/?overnight=production-flow");
  await p.getByRole("button", { name: "Tone Match", exact: true }).click();
  await p.getByRole("button", { name: "Cloud API", exact: true }).click();
  await p.getByRole("button", { name: "Guitar audio", exact: true }).click();
  await p.getByRole("button", { name: "Use supplied dry guitar", exact: true }).click();
  await p.getByText("Guitar audio calibrated", { exact: true }).waitFor();
  check(await p.evaluate(() => window.__micRequests) === 0, "supplied-file calibration needs no microphone");
  await p.getByLabel("Mixed-song audio", { exact: true }).setInputFiles({ name: "Exhilarate-first-60s.wav", mimeType: "audio/wav", buffer: song });
  await p.getByRole("button", { name: "Separate guitar", exact: true }).click();
  await p.getByRole("heading", { name: "Compare the same passage" }).waitFor({ timeout: 600000 });
  check(Boolean(id), "real cloud job created through the built main app");
  await p.evaluate(id => { window.__overnightJobId = id; }, id);
  await p.waitForFunction(() => Array.from(document.querySelectorAll("button")).some(b => b.textContent === "Confirm reference" && !b.disabled), {}, { timeout: 60000 });
  await p.getByRole("button", { name: "Confirm reference", exact: true }).click();
  const before = await (await p.request.get(`http://127.0.0.1:4173/api/jobs/${id}`)).json();
  check(before.backend === "modal" && before.result.provenance.provider === "modal", "separation provenance is actual Modal GPU");
  await p.getByRole("button", { name: "Generate custom rig", exact: true }).click();
  await p.waitForFunction(() => { const section = document.querySelector("#custom-rig-title")?.closest("section"); return section?.querySelector("h3") || section?.querySelector("[role=alert]"); }, {}, { timeout: 240000 });
  const job = await (await p.request.get(`http://127.0.0.1:4173/api/jobs/${id}`)).json();
  if (job.generation?.status !== "ready") return { real: true, job_id: id, checks, generation: job.generation, errors };
  check(job.generation.rig_proposal.provenance.provider === "nebius", "actual NVIDIA/Nebius custom settings returned");
  check(job.generation.target_tone_features.fine_bands.length === 24, "server measured fine target spectrum");
  check(await p.getByRole("button", { name: "Apply custom rig", exact: true }).isDisabled(), "generation neither plays nor applies an unchecked graph");
  await p.getByRole("button", { name: "Check custom rig", exact: true }).click();
  await p.waitForFunction(() => Array.from(document.querySelectorAll("button")).some(b => b.textContent === "Apply custom rig" && !b.disabled), {}, { timeout: 90000 });
  await p.getByRole("button", { name: "Refine individual settings locally", exact: true }).click();
  await p.waitForFunction(() => { const section = document.querySelector("#custom-rig-title")?.closest("section"); return (section?.textContent.includes("Training feature distance") && Array.from(section.querySelectorAll("button")).some(b => b.textContent === "Apply custom rig" && !b.disabled)) || section?.querySelector("[role=alert]"); }, {}, { timeout: 600000 });
  const refineError = await p.locator("#custom-rig-title").evaluate(node => node.closest("section").querySelector("[role=alert]")?.textContent);
  if (refineError) throw Error(refineError);
  await p.getByRole("button", { name: "Apply custom rig", exact: true }).click();
  await p.getByText("AI custom rig · editable", { exact: true }).waitFor();
  check(await p.locator("#drive").isDisabled(), "shared audio engine uses the actual model rig");
  const rigName = await p.locator("#amp-title").innerText();
  await p.getByRole("button", { name: "Play dry recording", exact: true }).click();
  await p.getByText("Playing local dry recording", { exact: true }).waitFor();
  await p.getByRole("button", { name: "Record", exact: true }).click(); await p.waitForTimeout(2500);
  await p.getByRole("button", { name: "Finish", exact: true }).click();
  await p.getByText("Take saved to Recordings for playback or download.", { exact: true }).waitFor({ timeout: 30000 });
  await p.getByRole("button", { name: "Stop audio", exact: true }).click();
  await p.getByRole("button", { name: "Recordings", exact: true }).click();
  check(await p.locator(".recording-card").count() === 1, "processed dry-audio take saved in the main recording library");
  check((await p.locator(".recording-card").innerText()).includes(rigName), "saved take carries the applied rig name");
  const recorded = await p.locator(".recording-card audio").evaluate(async element => {
    const buffer = await new OfflineAudioContext(1, 1, 44100).decodeAudioData(await (await fetch(element.src)).arrayBuffer());
    let energy = 0; for (const sample of buffer.getChannelData(0)) { if (!Number.isFinite(sample)) throw Error("Invalid recorded output"); energy += sample * sample; }
    return { duration: buffer.duration, rms: Math.sqrt(energy / buffer.length) };
  });
  check(recorded.duration > 1 && recorded.rms > 1e-6, "saved take decodes to non-silent finite processed audio");
  await p.getByRole("button", { name: "Tone Match", exact: true }).click();
  await p.getByRole("button", { name: "Play backing passage", exact: true }).click(); await p.waitForTimeout(700);
  check(await p.locator('audio[aria-label="Guitar-reduced backing"]').evaluate(audio => !audio.paused && audio.currentTime > 0), "aligned backing plays through its separate transport");
  await p.getByRole("button", { name: "Stop audio", exact: true }).click();
  await p.setViewportSize({ width: 390, height: 844 });
  check(await p.evaluate(() => document.documentElement.scrollWidth <= innerWidth), "built main app has no narrow document overflow");
  await p.screenshot({ path: "data/verification/production-cloud-rig-narrow.png", fullPage: true });
  await p.setViewportSize({ width: 1440, height: 1000 });
  await p.screenshot({ path: "data/verification/production-cloud-rig-desktop.png", fullPage: true });
  const downloadEvent = p.waitForEvent("download"); await p.getByRole("button", { name: "Save rig JSON", exact: true }).click();
  const download = await downloadEvent; await download.saveAs(decodeURIComponent(root.slice(5)) + "/data/overnight-run/actual-applied-rig.json");
  check(await p.evaluate(() => window.__micRequests) === 0, "full file-mode flow never requests live capture");
  check(errors.length === 0, "no runtime page errors in the actual built flow");
  await p.evaluate(() => {
    document.querySelectorAll("audio").forEach(audio => { audio.pause(); audio.muted = false; });
    window.__testMutes.forEach(node => { node.gain.value = 1; }); AudioNode.prototype.connect = window.__originalConnect; HTMLMediaElement.prototype.play = window.__originalPlay;
  });
  return { real: true, job_id: id, model: job.generation.rig_proposal.provenance.model, prompt: job.generation.rig_proposal.prompt_version, checks, errors,
    recorded, elapsed_seconds: (Date.now()-started)/1000, rig_name: rigName, prototype_restored: true };
}
