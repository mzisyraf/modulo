// Playwright browser_run_code_unsafe filename. All intercepted responses/audio are TEST ONLY.
async (page) => {
  page = await page.context().newPage();
  const checks = [], errors = [];
  const check = (ok, label) => { if (!ok) throw new Error(label); checks.push(label); };
  page.on("pageerror", (failure) => errors.push(failure.message));
  const id = "33333333-3333-4333-8333-333333333333";
  const option = (start, label) => ({ start_seconds: start, end_seconds: start + 15, label, explanation: "TEST ONLY signal contrast; not guitar identity", quality_flags: ["tone_difference_unverified"] });
  const options = [option(0, "Starting passage"), option(20, "Brighter texture"), option(40, "Steadier dynamics")];
  const job = { job_id: id, status: "ready", stage: "ready", expires_at: Date.now() / 1000 + 3600,
    result: { duration_seconds: 60, sample_rate: 44100, common_gain_linear: 1,
      provenance: { kind: "local_separation", model: "TEST ONLY", device: "Synthetic test" },
      artifacts: Object.fromEntries(["mix", "guitar", "backing"].map((name) => [name, `/api/jobs/${id}/audio/${name}`])),
      reference: null, reference_revision: 0, suggestion: null, quality_flags: ["separation_quality_unverified"] } };
  const wav = Buffer.alloc(44 + 44100 * 2 * 60);
  wav.write("RIFF"); wav.writeUInt32LE(wav.length - 8, 4); wav.write("WAVEfmt ", 8);
  wav.writeUInt32LE(16, 16); wav.writeUInt16LE(1, 20); wav.writeUInt16LE(1, 22);
  wav.writeUInt32LE(44100, 24); wav.writeUInt32LE(88200, 28); wav.writeUInt16LE(2, 32);
  wav.writeUInt16LE(16, 34); wav.write("data", 36); wav.writeUInt32LE(wav.length - 44, 40);
  const waveforms = { mix: Array.from({ length: 400 }, (_, i) => .4 + .1 * Math.sin(i / 5)), guitar: Array.from({ length: 400 }, (_, i) => .2 + .12 * Math.sin(i / 9)) };
  let empty = false, broken = false, confirmation;
  await page.route("**/api/**", async (route) => {
    const request = route.request(), path = new URL(request.url()).pathname;
    const json = (value, status = 200) => route.fulfill({ status, contentType: "application/json", body: JSON.stringify(value) });
    if (path === "/api/health") return json({ status: "ok", mode: "scaffold", separation_available: true, preset_generation_available: false });
    if (path === "/api/jobs" && request.method() === "POST") return json({ job_id: id, status: "ready" }, 202);
    if (path.endsWith("/references")) return broken ? json({ error: { message: "TEST ONLY waveform error" } }, 503) : json({ method: "signal_contrast_v1", duration_seconds: 60, options: empty ? [] : options, waveforms });
    if (path.endsWith("/reference") && request.method() === "POST") {
      confirmation = request.postDataJSON();
      job.result.reference = { ...confirmation, quality_flags: ["manual_selection"], explanation: "TEST ONLY confirmed interval" };
      job.result.reference_revision++;
      return json(job.result.reference);
    }
    if (path.includes("/audio/")) return route.fulfill({ contentType: "audio/wav", body: wav });
    return json(job);
  });
  await page.goto("http://127.0.0.1:5174");
  await page.getByRole("button", { name: "Tone Match", exact: true }).click();
  const upload = async () => {
    await page.getByLabel("Mixed-song audio", { exact: true }).setInputFiles({ name: "TEST-ONLY.wav", mimeType: "audio/wav", buffer: wav });
    await page.getByRole("button", { name: "Separate guitar", exact: true }).click();
  };
  await upload();
  await page.locator(".reference-options button").first().waitFor();
  check(await page.locator(".reference-options button").count() === 3, "three suggested regions share one full-song waveform");
  check(await page.locator("#reference-start").isDisabled(), "suggested timestamps are read-only");
  await page.locator(".reference-options button").nth(1).click();
  check(await page.locator("#reference-start").inputValue() === "20", "passage card selects fixed interval");
  await page.getByRole("button", { name: "Select reference C on waveform", exact: true }).click();
  check(await page.locator("#reference-end").inputValue() === "55", "waveform region selects fixed interval");
  check(await page.evaluate(() => [...document.querySelectorAll("audio")].every((a) => a.paused)), "selecting suggestions never autoplays");
  await page.evaluate(() => { window.__sharedWaveform = document.querySelector(".reference-waveform"); });
  await page.getByRole("button", { name: "Confirm reference", exact: true }).click();
  await page.getByText("Reference confirmed:", { exact: false }).waitFor();
  check(confirmation.start_seconds === 40 && confirmation.end_seconds === 55, "suggested and manual modes use existing server confirmation");
  await page.getByRole("button", { name: "Manual selection", exact: true }).click();
  check(await page.evaluate(() => window.__sharedWaveform === document.querySelector(".reference-waveform")), "mode toggle keeps the same waveform element");
  check(await page.getByText("Reference confirmed:", { exact: false }).count() === 0, "mode toggle invalidates confirmation");
  check(await page.locator("#reference-start").isEnabled(), "manual timestamps unlock");
  await page.getByRole("slider", { name: "Selection start", exact: true }).press("ArrowRight");
  check(await page.locator("#reference-start").inputValue() === "41", "keyboard resize moves one second");
  await page.getByRole("button", { name: "Move selected passage", exact: true }).press("Shift+ArrowLeft");
  check(await page.locator("#reference-start").inputValue() === "36" && await page.locator("#reference-end").inputValue() === "50", "keyboard move preserves length");
  await page.locator("#reference-start").fill("0"); await page.locator("#reference-end").fill("15");
  const bounds = await page.locator(".reference-waveform").boundingBox();
  const point = (second) => bounds.x + second / 60 * bounds.width;
  const end = await page.getByRole("slider", { name: "Selection end", exact: true }).boundingBox();
  await page.mouse.move(end.x + end.width / 2, end.y + end.height / 2); await page.mouse.down();
  await page.mouse.move(point(35), bounds.y + bounds.height / 2, { steps: 8 }); await page.mouse.up();
  check(await page.locator("#reference-end").inputValue() === "20", "drag resize stops at twenty seconds");
  await page.mouse.move(point(55), bounds.y + 20); await page.mouse.down();
  await page.mouse.move(point(25), bounds.y + 20, { steps: 8 }); await page.mouse.up();
  check(await page.locator("#reference-start").inputValue() === "25" && await page.locator("#reference-end").inputValue() === "45", "drag on empty waveform creates a bounded reverse selection");
  await page.locator("#reference-start").fill("10"); await page.locator("#reference-end").fill("25");
  await page.getByRole("button", { name: "Original mix", exact: true }).click();
  await page.getByRole("button", { name: "Play passage", exact: true }).click();
  await page.waitForFunction(() => { const audio = document.querySelector('audio[aria-label="Original mix"]'); return !audio.paused && audio.currentTime >= 9.95; });
  check(await page.evaluate(() => document.querySelector('audio[aria-label="Original mix"]').currentTime >= 9.95), "shared preview plays the chosen interval and source");
  await page.getByRole("button", { name: "Extracted guitar", exact: true }).click();
  check(await page.evaluate(() => [...document.querySelectorAll("audio")].every((a) => a.paused)), "source toggle stops preview without autoplay");
  check(await page.locator("#reference-start").inputValue() === "10", "listening source preserves interval");
  await page.getByRole("button", { name: "Confirm reference", exact: true }).click();
  await page.getByText("Reference confirmed:", { exact: false }).waitFor();
  check(confirmation.start_seconds === 10 && confirmation.end_seconds === 25, "manual interval confirms exact bounds");
  await page.getByRole("button", { name: "Suggested passages", exact: true }).click();
  check(await page.locator("#reference-start").isDisabled() && await page.locator("#reference-start").inputValue() === "0", "returning to suggestions restores fixed option");
  await page.setViewportSize({ width: 390, height: 844 });
  check(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), "mobile selector has no horizontal overflow");
  await page.screenshot({ path: "data/verification/reference-waveform-narrow.png", fullPage: true });
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.screenshot({ path: "data/verification/reference-waveform-desktop.png", fullPage: true });
  empty = true;
  await upload();
  await page.getByText("No contrasting passage suggestions found.", { exact: false }).waitFor();
  check(await page.locator("#reference-start").isEnabled(), "no options falls back honestly to manual waveform");
  broken = true; await upload();
  await page.getByText("TEST ONLY waveform error", { exact: false }).waitFor();
  await page.getByRole("button", { name: "Manual selection", exact: true }).click();
  await page.locator("#reference-start").fill("20"); await page.locator("#reference-end").fill("35");
  broken = false; empty = false;
  await page.getByRole("button", { name: "Reload waveform", exact: true }).click();
  await page.locator(".reference-options button").first().waitFor();
  check(await page.locator("#reference-start").inputValue() === "20", "waveform retry does not overwrite manual edits");
  check(errors.length === 0, `no page errors: ${errors.join("; ")}`);
  await page.unroute("**/api/**");
  return { synthetic: true, checks, errors };
}
