import example from "../../../fixtures/preset.example.json";
import { AudioEngine, factoryRigPresets, getRigCatalog, allRigModules, createRigModule, exportRigPreset, importRigPreset, type RigPreset, type ModuleType } from "../src/index.ts";

const element = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;
const engine = new AudioEngine(example as any), factories = factoryRigPresets(), catalog = getRigCatalog();
let draft = factories[0], initialized = false, rendering: AbortController | undefined, recording = false;
const urls = new Set<string>(); let counter = 0;
const status = (message: string) => { element("status").textContent = message; };
const run = (action: () => unknown) => async () => { try { await action(); } catch (error) { status(error instanceof Error ? error.message : String(error)); } };
const option = (select: HTMLSelectElement, value: string, text: string) => { const item = document.createElement("option"); item.value = value; item.textContent = text; select.append(item); };
const on = (id: string, action: () => unknown) => { element(id).onclick = run(action); };
const download = (blob: Blob, filename: string) => { const url = URL.createObjectURL(blob), link = document.createElement("a"); urls.add(url); link.href = url; link.download = filename; link.click(); setTimeout(() => { URL.revokeObjectURL(url); urls.delete(url); }, 30000); };
async function apply(next: RigPreset) { if (await engine.applyRigPreset(next)) { draft = engine.getRigPreset()!; initialized = true; draw(); } }
async function ready() { if (!initialized) await apply(draft); }
function draw() {
  element<HTMLTextAreaElement>("json").value = exportRigPreset(draft);
  const snapshots = element<HTMLSelectElement>("snapshots"); snapshots.replaceChildren(); draft.snapshots.forEach(item => option(snapshots, item.id, item.name));
  const chain = element("chain"); chain.replaceChildren();
  for (const module of allRigModules(draft)) {
    const definition = catalog[module.type], article = document.createElement("article"), heading = document.createElement("h2"), model = document.createElement("select");
    heading.textContent = `${definition.name} · ${module.id}`; article.append(heading); model.setAttribute("aria-label", `${module.id} model`); model.disabled = !initialized;
    definition.models.forEach(item => option(model, item.id, item.name)); model.value = module.model;
    model.onchange = run(async () => { const next = structuredClone(draft), target = allRigModules(next).find(item => item.id === module.id)!; target.model = model.value; if (target.model === "custom") target.parameters.ir_id = engine.listCabinetIRs()[0]?.id ?? "none"; await apply(next); });
    article.append(model);
    const note = document.createElement("p"); note.textContent = definition.models.find(item => item.id === module.model)!.character; article.append(note);
    if (!["input", "output"].includes(module.type)) {
      const label = document.createElement("label"), toggle = document.createElement("input"); toggle.type = "checkbox"; toggle.checked = module.on; toggle.disabled = !initialized;
      toggle.onchange = run(() => { engine.setRigModuleEnabled(module.id, toggle.checked); draft = engine.getRigPreset()!; element<HTMLTextAreaElement>("json").value = exportRigPreset(draft); });
      label.append("Enabled", toggle); article.append(label);
    }
    for (const [key, control] of Object.entries(definition.controls)) {
      const label = document.createElement("label"), input = control.kind === "choice" ? document.createElement("select") : document.createElement("input"), output = document.createElement("output");
      label.append(key.replaceAll("_", " ")); input.setAttribute("aria-label", `${module.id} ${key}`);
      input.disabled = !initialized;
      if (input instanceof HTMLSelectElement) { const choices = key === "ir_id" ? ["none", ...engine.listCabinetIRs().map(item => item.id)] : control.choices!; choices.forEach(value => option(input, value, value)); input.value = String(module.parameters[key]); }
      else if (control.kind === "boolean") { input.type = "checkbox"; input.checked = Boolean(module.parameters[key]); }
      else { input.type = "range"; input.min = String(control.min); input.max = String(control.max); input.step = String((control.max! - control.min!) / 200); input.value = String(module.parameters[key]); output.textContent = `${Number(module.parameters[key]).toFixed(2)} ${control.unit ?? ""}`; }
      const change = run(async () => {
        const value = input instanceof HTMLSelectElement ? input.value : input.type === "checkbox" ? input.checked : Number(input.value);
        if (typeof value === "number") output.textContent = `${value.toFixed(2)} ${control.unit ?? ""}`;
        if (control.realtime) { engine.setRigParameter(module.id, key, value as number | boolean); draft = engine.getRigPreset()!; element<HTMLTextAreaElement>("json").value = exportRigPreset(draft); }
        else { const next = structuredClone(draft); allRigModules(next).find(item => item.id === module.id)!.parameters[key] = value; await apply(next); }
      });
      if (control.kind === "number" && control.realtime) input.oninput = change; else input.onchange = change;
      label.append(input, output); article.append(label);
    }
    chain.append(article);
  }
}
const factory = element<HTMLSelectElement>("factory"), modules = element<HTMLSelectElement>("module");
factories.forEach((item, index) => option(factory, String(index), item.name));
(Object.keys(catalog) as ModuleType[]).filter(type => !["input", "output"].includes(type)).forEach(type => option(modules, type, catalog[type].name));
on("load", () => apply(factories[Number(factory.value)]));
on("add", async () => { await ready(); const next = structuredClone(draft); next.chain.splice(next.chain.length - 1, 0, createRigModule(modules.value as ModuleType, undefined, `module_${++counter}_${Date.now()}`)); await apply(next); });
on("start", async () => { await ready(); if (await engine.startLive(element<HTMLSelectElement>("device").value || undefined, Number(element<HTMLSelectElement>("channel").value))) status("Live input active. Play quietly first; Stop should silence monitoring."); });
on("stop", () => { engine.stop(); status("Stopped."); });
on("pluck", async () => { await ready(); await engine.playTestSignal(); status("Playing the synthetic test signal."); });
element<HTMLInputElement>("audition").onchange = run(async () => { const file = element<HTMLInputElement>("audition").files?.[0]; if (file) { await ready(); await engine.playFile(file); status("Playing the local dry file."); } });
element<HTMLInputElement>("bypass").onchange = () => engine.setBypass(element<HTMLInputElement>("bypass").checked);
element<HTMLInputElement>("mute").onchange = () => engine.setTunerMuted(element<HTMLInputElement>("mute").checked);
on("devices", async () => { const select = element<HTMLSelectElement>("device"); select.replaceChildren(); option(select, "", "Default input"); (await navigator.mediaDevices.enumerateDevices()).filter(item => item.kind === "audioinput").forEach((item, i) => option(select, item.deviceId, item.label || `Input device ${i + 1}`)); });
on("save-snapshot", async () => { await ready(); engine.saveRigSnapshot(`snapshot_${Date.now()}`, element<HTMLInputElement>("snapshot-name").value); draft = engine.getRigPreset()!; draw(); status("Snapshot saved in this rig."); });
on("recall", async () => { await engine.loadRigSnapshot(element<HTMLSelectElement>("snapshots").value); draft = engine.getRigPreset()!; draw(); });
on("midi", async () => { await ready(); const devices = await engine.midi.connect(); status(`MIDI connected: ${devices.map(item => item.name).join(", ") || "no inputs detected"}`); });
engine.midi.onError = error => status(String(error));
on("record", async () => {
  if (recording) throw new Error("Finish or discard the current recording."); recording = true; status("Recording…");
  try {
    const result = await engine.startRigRecording({ mode: element<HTMLSelectElement>("record-mode").value as "dry" | "wet" | "both" });
    if (element("takes").children.length >= 12) { const old = element("takes").firstElementChild!; for (const audio of old.querySelectorAll("audio")) { URL.revokeObjectURL(audio.src); urls.delete(audio.src); } old.remove(); }
    const article = document.createElement("article");
    for (const key of ["dry", "wet"] as const) if (result[key]) { const take = result[key]!, title = document.createElement("h2"), audio = document.createElement("audio"), link = document.createElement("a"), url = URL.createObjectURL(take.blob); urls.add(url); title.textContent = `${key} · ${take.durationSeconds.toFixed(1)}s`; audio.controls = true; audio.src = url; link.href = url; link.download = `${key}.${take.mimeType.includes("mp4") ? "mp4" : take.mimeType.includes("ogg") ? "ogg" : "webm"}`; link.textContent = "Download"; article.append(title, audio, link); }
    element("takes").prepend(article); status("Recording saved in this tab.");
  } finally { recording = false; }
});
on("finish", () => { engine.finishRigRecording(); status("Finalizing recording…"); }); on("discard", () => engine.cancelRigRecording());
on("import-ir", async () => { const file = element<HTMLInputElement>("ir").files?.[0]; if (!file) throw new Error("Choose an IR file first."); await engine.loadCabinetIR(element<HTMLInputElement>("ir-id").value, file); draw(); status("IR imported. Choose User cabinet IR on a cabinet module."); });
on("export", () => download(new Blob([exportRigPreset(engine.getRigPreset() ?? draft)], { type: "application/json" }), "modulo-rig.json"));
element<HTMLInputElement>("import").onchange = run(async () => { const file = element<HTMLInputElement>("import").files?.[0]; if (file) { if (file.size > 256 * 1024) throw new Error("Preset is too large."); await apply(importRigPreset(await file.text())); status("Preset imported."); } });
on("apply-json", () => apply(importRigPreset(element<HTMLTextAreaElement>("json").value)));
on("render", async () => { const file = element<HTMLInputElement>("render-file").files?.[0]; if (!file) throw new Error("Choose an offline input file first."); if (rendering) throw new Error("A render is already running."); await ready(); rendering = new AbortController(); status("Rendering WAV…"); try { const result = await engine.renderRigFile(file, { signal: rendering.signal }); download(result.blob, "modulo-wet.wav"); status(`Rendered ${result.durationSeconds.toFixed(1)}s in ${result.renderMilliseconds.toFixed(0)}ms.`); } finally { rendering = undefined; } });
on("cancel-render", () => rendering?.abort());
engine.onRigError = status;
const timer = setInterval(() => { const level = engine.getInputLevel(), tuner = engine.getTunerReading(); element("meter").textContent = `Dry meter: ${level ? (20 * Math.log10(Math.max(1e-6, level.rms))).toFixed(1) + " dBFS" : "—"} · Tuner: ${tuner ? `${tuner.note} ${tuner.cents.toFixed(0)} cents` : "—"}`; element("diagnostics").textContent = JSON.stringify(engine.getDiagnostics(), null, 2); }, 200);
window.addEventListener("pagehide", () => { clearInterval(timer); rendering?.abort(); urls.forEach(URL.revokeObjectURL); void engine.dispose(); });
draw();
