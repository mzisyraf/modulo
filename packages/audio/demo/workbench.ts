import example from "../../../fixtures/preset.example.json";
import { AudioEngine, factoryRigPresets, getRigCatalog, allRigModules, exportRigPreset, importRigPreset, type RigPreset, type ModuleType } from "../src/index.ts";
import { editRig, recommendedModels, type RigEdit } from "./rigEditor.ts";
import { createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { flushSync } from "react-dom";
import { ModelControls } from "../../../apps/web/src/ModelControls.tsx";
import { changeGearModel, resetGearModel, modelFor, type Value } from "../src/index.ts";

const element = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;
const engine = new AudioEngine(example as any), factories = factoryRigPresets(), catalog = getRigCatalog();
let draft = factories[0], initialized = false, rendering: AbortController | undefined, recording = false;
const urls = new Set<string>(); let counter = 0;
let selectedId = "amp", recommendationRig: RigPreset | null = factories[0], editQueue = Promise.resolve();
type GearDrag = { action: "move"; id: string } | { action: "add"; type: ModuleType; model: string };
const dragType = "application/x-modulo-rig-gear";
let dragged: GearDrag | undefined;
let controlsRoot: Root | undefined;
const trayModels = new Map<ModuleType, string>();
const status = (message: string) => { element("status").textContent = message; };
const run = (action: () => unknown) => async () => { try { await action(); } catch (error) { status(error instanceof Error ? error.message : String(error)); } };
const option = (select: HTMLSelectElement, value: string, text: string) => { const item = document.createElement("option"); item.value = value; item.textContent = text; select.append(item); };
const on = (id: string, action: () => unknown) => { element(id).onclick = run(action); };
const download = (blob: Blob, filename: string) => { const url = URL.createObjectURL(blob), link = document.createElement("a"); urls.add(url); link.href = url; link.download = filename; link.click(); setTimeout(() => { URL.revokeObjectURL(url); urls.delete(url); }, 30000); };
async function apply(next: RigPreset) {
  try { if (await engine.applyRigPreset(next)) { draft = engine.getRigPreset()!; initialized = true; draw(); return true; } return false; }
  catch (error) { draw(); throw error; }
}
async function ready() { if (!initialized) await apply(draft); }
function enqueue(action: () => Promise<unknown>): Promise<unknown> { const pending = editQueue.then(action); editQueue = pending.then(() => {}, () => {}); return pending; }
function changeRig(edit: RigEdit) { return enqueue(async () => {
  await ready(); const previousSplit = draft.parallel?.after, next = editRig(draft, edit);
  if (await apply(next)) { if (edit.action !== "remove") selectedId = edit.id; else engine.midi.cancelLearn(); draw(); status(edit.action === "remove" ? `Gear removed. Saved snapshots and MIDI mappings were updated.${previousSplit !== next.parallel?.after ? ` Parallel paths now split after ${next.parallel!.after}.` : ""}` : "Rig updated. Select a pedal or amp to adjust its controls."); }
}); }
function modelChoices(select: HTMLSelectElement, type: ModuleType, value: string) {
  const recommended = recommendedModels(recommendationRig, type), models = catalog[type].models;
  for (const [name, choices] of [[`★ Recommended · ${recommendationRig?.name ?? "rig"}`, models.filter(item => recommended.includes(item.id))], ["All other models", models.filter(item => !recommended.includes(item.id))]] as const) {
    if (!choices.length) continue; const group = document.createElement("optgroup"); group.label = recommended.length ? name : "All models";
    for (const item of choices) { const option = document.createElement("option"); option.value = item.id; option.textContent = `${recommended.includes(item.id) ? "★ " : ""}${item.name}`; group.append(option); }
    select.append(group);
  }
  select.value = value;
}
function button(text: string, action: () => unknown, label = text) { const node = document.createElement("button"); node.type = "button"; node.textContent = text; node.setAttribute("aria-label", label); node.dataset.focus = label; node.onclick = run(action); return node; }
function dragHandle(node: HTMLElement, payload: () => GearDrag) {
  node.draggable = true;
  node.ondragstart = event => { dragged = payload(); event.dataTransfer!.setData(dragType, JSON.stringify(dragged)); event.dataTransfer!.effectAllowed = dragged.action === "move" ? "move" : "copy"; document.body.classList.add("dragging"); };
  node.ondragend = () => { dragged = undefined; document.body.classList.remove("dragging"); document.querySelectorAll(".drop-over").forEach(node => node.classList.remove("drop-over")); };
}
function dropTarget(node: HTMLElement, target: string, before?: string, remove = false) {
  node.ondragover = event => { if (!event.dataTransfer?.types.includes(dragType)) return; event.preventDefault(); event.stopPropagation(); event.dataTransfer.dropEffect = remove ? "move" : dragged?.action === "add" ? "copy" : "move"; node.classList.add("drop-over"); };
  node.ondragleave = () => node.classList.remove("drop-over");
  node.ondrop = event => {
    if (!event.dataTransfer?.types.includes(dragType)) return; event.preventDefault(); event.stopPropagation(); node.classList.remove("drop-over"); document.body.classList.remove("dragging");
    void run(async () => {
      const text = event.dataTransfer!.getData(dragType); if (text.length > 2048) throw new Error("Invalid gear drop.");
      const payload: GearDrag = JSON.parse(text);
      if (payload.action === "move" && typeof payload.id === "string") await changeRig(remove ? { action: "remove", id: payload.id } : { ...payload, target, before });
      else if (payload.action === "add" && !remove && Object.hasOwn(catalog, payload.type)) await addGear(payload.type, payload.model, target, before);
      else throw new Error("Drag a pedal or amp from this workbench.");
    })();
  };
}
function addGear(type: ModuleType, model: string, target = element<HTMLSelectElement>("destination").value, before?: string) {
  return changeRig({ action: "add", type, model, target, before, id: `gear_${++counter}_${Date.now()}`, irId: engine.listCabinetIRs()[0]?.id });
}
function drawChains() {
  const container = element("chain"), positions = new Map([...container.querySelectorAll<HTMLElement>(".gear-rail")].map(node => [node.dataset.path, node.scrollLeft])); container.replaceChildren();
  const chains = [{ id: "main", name: "Main signal chain", modules: draft.chain }, ...(draft.parallel?.paths.map(path => ({ id: `path:${path.id}`, name: `${path.id} · splits after ${draft.parallel!.after} · ${path.level_db} dB`, modules: path.chain })) ?? [])];
  const destination = element<HTMLSelectElement>("destination"), oldTarget = destination.value; destination.replaceChildren(); chains.forEach(path => option(destination, path.id, path.id === "main" ? "Main chain" : path.name)); if (chains.some(path => path.id === oldTarget)) destination.value = oldTarget;
  for (const path of chains) {
    const heading = document.createElement("h3"), row = document.createElement("div"), rail = document.createElement("div"); heading.textContent = path.name; container.append(heading); row.className = "rail-row"; rail.className = "gear-rail"; rail.dataset.path = path.id; rail.tabIndex = 0; rail.setAttribute("aria-label", path.name);
    const gap = (before?: string) => { const slot = document.createElement("div"); slot.className = "drop-slot"; slot.textContent = "+"; slot.dataset.before = before ?? "end"; slot.setAttribute("aria-label", `Insert gear ${before ? `before ${before}` : "at end"}`); dropTarget(slot, path.id, before); rail.append(slot); };
    for (const [index, module] of path.modules.entries()) {
      const fixed = ["input", "output"].includes(module.type), card = document.createElement("article"); card.className = `chain-card${selectedId === module.id ? " selected" : ""}${module.on ? "" : " off"}`; card.dataset.module = module.id;
      if (module.type !== "input") gap(module.id);
      const title = button(catalog[module.type].name, () => { selectedId = module.id; draw(); }, `Edit ${catalog[module.type].name} ${module.id}`); title.className = "gear-title"; title.setAttribute("aria-pressed", String(selectedId === module.id)); title.dataset.focus = `select_${module.id}`;
      const name = document.createElement("small"); name.textContent = catalog[module.type].models.find(item => item.id === module.model)!.name;
      const state = document.createElement("span"); state.className = "gear-state"; state.textContent = fixed ? "Fixed" : module.on ? "Enabled" : "Bypassed";
      card.append(title, name, state);
      if (!fixed) {
        const actions = document.createElement("div"); actions.className = "card-actions";
        const handle = button("⠿ Drag", () => { selectedId = module.id; draw(); }, `Drag ${module.id}`); dragHandle(handle, () => ({ action: "move", id: module.id }));
        const left = button("←", () => changeRig({ action: "move", id: module.id, target: path.id, before: path.modules[index - 1]?.id }), `Move ${module.id} earlier`);
        const right = button("→", () => changeRig({ action: "move", id: module.id, target: path.id, before: path.modules[index + 2]?.id }), `Move ${module.id} later`);
        left.disabled = index <= (path.id === "main" ? 1 : 0); right.disabled = index >= path.modules.length - (path.id === "main" ? 2 : 1);
        actions.append(handle, left, right, button("Remove", () => changeRig({ action: "remove", id: module.id }), `Remove ${module.id}`)); card.append(actions);
      }
      dropTarget(card, path.id, module.id); rail.append(card);
    }
    if (path.id !== "main") gap();
    row.append(button("‹", () => rail.scrollBy({ left: -rail.clientWidth * 0.8, behavior: "smooth" }), `Scroll ${path.id} left`), rail, button("›", () => rail.scrollBy({ left: rail.clientWidth * 0.8, behavior: "smooth" }), `Scroll ${path.id} right`)); container.append(row); rail.scrollLeft = positions.get(path.id) ?? 0;
  }
}
function drawTray() {
  const tray = element("gear-tray"), scroll = tray.scrollLeft; tray.replaceChildren();
  for (const type of Object.keys(catalog) as ModuleType[]) if (!["input", "output"].includes(type)) {
    const article = document.createElement("article"), heading = document.createElement("h3"), model = document.createElement("select"), recommended = recommendedModels(recommendationRig, type);
    article.className = "library-card"; article.dataset.type = type; heading.textContent = catalog[type].name;
    modelChoices(model, type, trayModels.get(type) ?? recommended[0] ?? catalog[type].models[0].id); model.setAttribute("aria-label", `Library ${type} model`); model.dataset.focus = `library_${type}`;
    model.onchange = () => trayModels.set(type, model.value);
    const handle = button("⠿ Drag to chain", () => addGear(type, model.value), `Add or drag ${type}`); dragHandle(handle, () => ({ action: "add", type, model: model.value }));
    article.append(heading, model, handle, button("+ Add", () => addGear(type, model.value), `Add ${type}`)); tray.append(article);
  }
  tray.scrollLeft = scroll;
}
function draw() {
  const focus = document.activeElement instanceof HTMLElement ? document.activeElement.dataset.focus : undefined;
  if (!allRigModules(draft).some(module => module.id === selectedId)) selectedId = draft.chain.find(module => module.type === "amp")?.id ?? draft.chain[0].id;
  element<HTMLTextAreaElement>("json").value = exportRigPreset(draft);
  element("rig-name").textContent = draft.name;
  const snapshots = element<HTMLSelectElement>("snapshots"), selectedSnapshot = snapshots.value; snapshots.replaceChildren(); draft.snapshots.forEach(item => option(snapshots, item.id, item.name)); if (draft.snapshots.some(item => item.id === selectedSnapshot)) snapshots.value = selectedSnapshot;
  drawChains(); drawTray();
  controlsRoot?.unmount(); controlsRoot = undefined;
  const chain = element("controls"); chain.replaceChildren();
  for (const module of allRigModules(draft).filter(module => module.id === selectedId)) {
    const definition = catalog[module.type], article = document.createElement("article"), heading = document.createElement("h2"), model = document.createElement("select");
    heading.textContent = definition.name; article.append(heading); model.setAttribute("aria-label", `${module.id} model`); model.disabled = !initialized;
    modelChoices(model, module.type, module.model); model.dataset.focus = `model_${module.id}`;
    model.onchange = run(() => enqueue(async () => { try { await apply(changeGearModel(draft, module.id, `${module.type}.${model.value}`, engine.listCabinetIRs()[0]?.id)); } catch (error) { draw(); throw error; } }));
    article.append(model);
    const reset = button("Reset model defaults", () => enqueue(() => apply(resetGearModel(draft, module.id)))); reset.disabled = !initialized; article.append(reset);
    const note = document.createElement("p"); note.textContent = definition.models.find(item => item.id === module.model)!.character;
    if (recommendedModels(recommendationRig, module.type).includes(module.model)) note.textContent = `★ Recommended for ${recommendationRig!.name}. ${note.textContent}`;
    article.append(note);
    if (!["input", "output"].includes(module.type)) {
      const label = document.createElement("label"), toggle = document.createElement("input"); toggle.type = "checkbox"; toggle.checked = module.on; toggle.disabled = !initialized;
      toggle.dataset.focus = `enabled_${module.id}`;
      toggle.onchange = run(() => { engine.setRigModuleEnabled(module.id, toggle.checked); draft = engine.getRigPreset()!; draw(); });
      label.append("Enabled", toggle); article.append(label);
    }
    const host = document.createElement("div"); article.append(host); controlsRoot = createRoot(host);
    const root = controlsRoot;
    let firstRender = true;
    const renderParameters = () => {
      const current = allRigModules(draft).find(item => item.id === module.id); if (!current || controlsRoot !== root) return;
      const render = () => root.render(createElement(ModelControls, { module: current, disabled: !initialized, assets: engine.listCabinetIRs(), onChange: (key: string, value: Value) => {
        void run(async () => {
          try {
            const parameter = modelFor(current).parameters.find(item => item.id === key)!;
            if (parameter.realtime) { await engine.setModelParameter(current.id, key, value); draft = engine.getRigPreset()!; element<HTMLTextAreaElement>("json").value = exportRigPreset(draft); renderParameters(); }
            else await enqueue(async () => { if (await engine.setModelParameter(current.id, key, value)) { draft = engine.getRigPreset()!; draw(); } });
          } catch (error) { renderParameters(); throw error; }
        })();
      } }));
      if (firstRender) { flushSync(render); firstRender = false; } else render();
    };
    renderParameters();
    chain.append(article);
  }
  if (focus) {
    const target = document.querySelector<HTMLElement>(`[data-focus="${CSS.escape(focus)}"]`);
    if (target && !(target instanceof HTMLButtonElement && target.disabled)) target.focus({ preventScroll: true });
    else document.querySelector<HTMLElement>(`[data-focus="select_${CSS.escape(selectedId)}"]`)?.focus({ preventScroll: true });
  }
}
const factory = element<HTMLSelectElement>("factory");
factories.forEach((item, index) => option(factory, String(index), item.name));
on("load", () => enqueue(async () => { const next = factories[Number(factory.value)]; if (await apply(next)) { recommendationRig = next; trayModels.clear(); selectedId = allRigModules(next).find(item => item.type === "amp")?.id ?? "input"; draw(); status(`${next.name} loaded. All gear remains available in the library below.`); } }));
on("tray-left", () => element("gear-tray").scrollBy({ left: -500, behavior: "smooth" })); on("tray-right", () => element("gear-tray").scrollBy({ left: 500, behavior: "smooth" }));
dropTarget(element("remove-gear"), "main", undefined, true);
on("start", async () => { await ready(); if (await engine.startLive(element<HTMLSelectElement>("device").value || undefined, Number(element<HTMLSelectElement>("channel").value))) status("Live input active. Play quietly first; Stop should silence monitoring."); });
on("stop", () => { engine.stop(); status("Stopped."); });
on("pluck", async () => { await ready(); await engine.playTestSignal(); status("Playing the synthetic test signal."); });
element<HTMLInputElement>("audition").onchange = run(async () => { const file = element<HTMLInputElement>("audition").files?.[0]; if (file) { await ready(); await engine.playFile(file); status("Playing the local dry file."); } });
element<HTMLInputElement>("bypass").onchange = () => engine.setBypass(element<HTMLInputElement>("bypass").checked);
element<HTMLInputElement>("mute").onchange = () => engine.setTunerMuted(element<HTMLInputElement>("mute").checked);
on("devices", async () => { const select = element<HTMLSelectElement>("device"); select.replaceChildren(); option(select, "", "Default input"); (await navigator.mediaDevices.enumerateDevices()).filter(item => item.kind === "audioinput").forEach((item, i) => option(select, item.deviceId, item.label || `Input device ${i + 1}`)); });
on("save-snapshot", async () => { await ready(); engine.saveRigSnapshot(`snapshot_${Date.now()}`, element<HTMLInputElement>("snapshot-name").value); draft = engine.getRigPreset()!; draw(); status("Snapshot saved in this rig."); });
on("recall", () => enqueue(async () => { await engine.loadRigSnapshot(element<HTMLSelectElement>("snapshots").value); draft = engine.getRigPreset()!; draw(); }));
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
element<HTMLInputElement>("import").onchange = run(async () => { const input = element<HTMLInputElement>("import"), file = input.files?.[0]; input.value = ""; if (file) { if (file.size > 256 * 1024) throw new Error("Preset is too large."); const next = importRigPreset(await file.text()); await enqueue(async () => { if (await apply(next)) { recommendationRig = null; draw(); status("Preset imported. All model choices remain available."); } }); } });
on("apply-json", () => { const next = importRigPreset(element<HTMLTextAreaElement>("json").value); return enqueue(async () => { if (await apply(next)) { recommendationRig = null; draw(); } }); });
on("render", async () => { const file = element<HTMLInputElement>("render-file").files?.[0]; if (!file) throw new Error("Choose an offline input file first."); if (rendering) throw new Error("A render is already running."); await ready(); rendering = new AbortController(); status("Rendering WAV…"); try { const result = await engine.renderRigFile(file, { signal: rendering.signal }); download(result.blob, "modulo-wet.wav"); status(`Rendered ${result.durationSeconds.toFixed(1)}s in ${result.renderMilliseconds.toFixed(0)}ms.`); } finally { rendering = undefined; } });
on("cancel-render", () => rendering?.abort());
engine.onRigError = status;
const timer = setInterval(() => { const level = engine.getInputLevel(), tuner = engine.getTunerReading(); element("meter").textContent = `Dry meter: ${level ? (20 * Math.log10(Math.max(1e-6, level.rms))).toFixed(1) + " dBFS" : "—"} · Tuner: ${tuner ? `${tuner.note} ${tuner.cents.toFixed(0)} cents` : "—"}`; element("diagnostics").textContent = JSON.stringify(engine.getDiagnostics(), null, 2); }, 200);
window.addEventListener("pagehide", () => { clearInterval(timer); rendering?.abort(); controlsRoot?.unmount(); urls.forEach(URL.revokeObjectURL); void engine.dispose(); });
draw();
