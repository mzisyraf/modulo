import { useEffect, useRef, useState, type RefObject } from "react";
import { AudioEngine, GEAR_CATEGORIES, allRigModules, changeGearModel, resetGearModel, createRigPreset, editRig, exportRigPreset, getGearModels, importRigPreset, modelFor, parameterToDSP, parseRigPreset, type GearCategory, type RigEdit, type RigPreset, type Value } from "@modulo/audio";
import type { Preset } from "@modulo/contracts";
import { ModelControls } from "./ModelControls";

interface Props { engineRef: RefObject<AudioEngine | null>; value: RigPreset | null; legacyPreset: Preset }
function initialRig(): RigPreset {
  const rig = createRigPreset("Studio model rig");
  const clean = changeGearModel(rig, "amp", "amp.studio_clean");
  for (const item of clean.chain) if (["overdrive", "gate"].includes(item.type)) item.on = false;
  return clean;
}

export function ModelRigPanel({ engineRef, value, legacyPreset }: Props) {
  const [draft, setDraft] = useState(initialRig), [selectedId, setSelectedId] = useState("amp"), [category, setCategory] = useState<GearCategory | "all">("all");
  const [libraryId, setLibraryId] = useState("delay.single_tap"), [busy, setBusy] = useState(false), [message, setMessage] = useState("Edit this local rig, then choose Use model rig to hear it through the existing player or live input.");
  const [assets, setAssets] = useState<{ id: string; name: string }[]>(() => engineRef.current?.listCabinetIRs() ?? []), [destination, setDestination] = useState("main");
  const [irAssetId, setIRAssetId] = useState("my_cab");
  const mounted = useRef(true), urls = useRef(new Set<string>()), actionToken = useRef(0);
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; actionToken.current++; urls.current.forEach(URL.revokeObjectURL); }; }, []);
  const rig = value ?? draft, modules = allRigModules(rig), selected = modules.find(item => item.id === selectedId) ?? modules.find(item => item.type === "amp") ?? modules[0];
  const models = getGearModels(category === "all" ? undefined : category).filter(item => !["input", "output"].includes(item.type));
  const libraryModel = models.find(item => item.id === libraryId) ?? models[0];
  const chains = [{ id: "main", name: "Main chain", chain: rig.chain }, ...(rig.parallel?.paths.map(path => ({ id: `path:${path.id}`, name: path.id.replaceAll("_", " "), chain: path.chain })) ?? [])];
  const target = chains.some(chain => chain.id === destination) ? destination : "main";
  const run = async (action: () => Promise<void> | void) => {
    if (busy) return; const token = ++actionToken.current; setBusy(true);
    try { await action(); } catch (error) { if (mounted.current && token === actionToken.current) setMessage(error instanceof Error ? error.message : String(error)); }
    finally { if (mounted.current && token === actionToken.current) setBusy(false); }
  };
  async function commit(next: RigPreset) {
    if (!mounted.current) return false;
    const audio = engineRef.current;
    if (value) { if (!audio) throw new Error("Audio is not ready yet."); if (!await audio.applyRigPreset(next)) return false; }
    if (mounted.current) setDraft(next); return true;
  }
  function edit(operation: RigEdit) { void run(async () => { if (await commit(editRig(engineRef.current?.getRigPreset() ?? draft, operation))) { if (operation.action !== "remove") setSelectedId(operation.id); setMessage("Rig updated. All exposed controls belong to the selected model."); } }); }
  function changeParameter(id: string, changed: Value) {
    const instance = selected.id;
    const parameter = modelFor(selected).parameters.find(item => item.id === id)!;
    const update = async () => {
      try {
        const audio = engineRef.current;
        if (value) { if (!audio) throw new Error("Audio is not ready."); await audio.setModelParameter(instance, id, changed); }
        else {
          const modelId = modelFor(selected).id, mapped = parameterToDSP(modelFor(selected), id, changed);
          if (mounted.current) setDraft(previous => {
            const next = structuredClone(previous), module = allRigModules(next).find(item => item.id === instance);
            if (!module || modelFor(module).id !== modelId) return previous;
            module.parameters[mapped.target] = mapped.value; return parseRigPreset(next);
          });
        }
      } catch (error) { if (mounted.current) setMessage(error instanceof Error ? error.message : String(error)); }
    };
    if (parameter.realtime) void update(); else void run(update);
  }
  function add(modelId: string, path = target, before?: string) {
    const info = getGearModels().find(item => item.id === modelId); if (!info) return;
    edit({ action: "add", id: `gear_${crypto.randomUUID().replaceAll("-", "")}`, type: info.type, model: info.model, target: path, before, irId: assets[0]?.id });
  }
  function onDrop(event: React.DragEvent, path: string, before?: string) {
    if (!event.dataTransfer.types.includes("application/x-modulo-model-gear")) return;
    event.preventDefault(); event.stopPropagation();
    const raw = event.dataTransfer.getData("application/x-modulo-model-gear"); if (raw.length > 256) return;
    try { const data = JSON.parse(raw); if (data.modelId) add(data.modelId, path, before); else if (typeof data.instanceId === "string") edit({ action: "move", id: data.instanceId, target: path, before }); }
    catch { setMessage("Use gear from this rig editor."); }
  }
  const dragOver = (event: React.DragEvent) => { if (event.dataTransfer.types.includes("application/x-modulo-model-gear")) event.preventDefault(); };
  function save() {
    const blob = new Blob([exportRigPreset(rig)], { type: "application/json" }), url = URL.createObjectURL(blob), link = document.createElement("a"); urls.current.add(url); link.href = url; link.download = "modulo-model-rig.json"; link.click(); setTimeout(() => { URL.revokeObjectURL(url); urls.current.delete(url); }, 30000);
  }

  return <section className="model-rig-panel" aria-labelledby="model-rig-title">
    <span className="step">MODEL RIG</span><h2 id="model-rig-title">Choose the gear. Shape its sound.</h2>
    <p>These local algorithmic models have their own controls. They are not a setup generated from your song or verified hardware emulations.</p>
    <div className="model-rig-toolbar"><strong>{value ? "Model rig active" : "Model rig draft"}</strong><button disabled={busy} onClick={() => void run(async () => { const audio = engineRef.current; if (!audio) throw new Error("Audio is not ready yet."); if (await audio.applyRigPreset(rig)) { setDraft(rig); setMessage("Model rig active. Use the existing audition or live input controls to listen."); } })}>Use model rig</button>
      <button className="secondary" disabled={!value || busy} onClick={() => { setDraft(rig); engineRef.current?.applyPreset(legacyPreset); setMessage("Previous demo preset restored."); }}>Use demo preset</button><button className="secondary" onClick={save}>Save rig JSON</button></div>
    {chains.map(path => <div key={path.id}><h3>{path.name}</h3><div className="model-rig-chain" onDragOver={dragOver} onDrop={event => onDrop(event, path.id)} aria-label={path.name}>
      {path.chain.map((module, index) => <div className={`model-rig-card${module.id === selected.id ? " is-selected" : ""}`} key={module.id} data-rig-instance={module.id} onDragOver={dragOver} onDrop={event => onDrop(event, path.id, module.id)}>
        <button className="secondary" onClick={() => setSelectedId(module.id)} aria-pressed={module.id === selected.id}>{modelFor(module).name}</button>
        <small>{module.on ? "Enabled" : "Bypassed"}</small>
        {!["input", "output"].includes(module.type) && <div className="model-rig-card-actions"><button disabled={busy} draggable onDragStart={event => event.dataTransfer.setData("application/x-modulo-model-gear", JSON.stringify({ instanceId: module.id }))} onClick={() => setSelectedId(module.id)} aria-label={`Drag ${module.id}`}>⠿</button>
          <button disabled={busy || index <= (path.id === "main" ? 1 : 0)} onClick={() => edit({ action: "move", id: module.id, target: path.id, before: path.chain[index - 1]?.id })} aria-label={`Move ${module.id} earlier`}>←</button>
          <button disabled={busy || index >= path.chain.length - (path.id === "main" ? 2 : 1)} onClick={() => edit({ action: "move", id: module.id, target: path.id, before: path.chain[index + 2]?.id })} aria-label={`Move ${module.id} later`}>→</button>
          <button disabled={busy} onClick={() => edit({ action: "remove", id: module.id })} aria-label={`Remove ${module.id}`}>Remove</button></div>}
      </div>)}
    </div></div>)}
    <div className="model-rig-toolbar"><label>Selected model <select aria-label="Selected gear model" disabled={busy} value={`${selected.type}.${selected.model}`} onChange={event => { const id = event.target.value; void run(async () => { await commit(changeGearModel(engineRef.current?.getRigPreset() ?? draft, selected.id, id, assets[0]?.id)); }); }}>
      {getGearModels().filter(model => model.type === selected.type).map(model => <option value={model.id} key={model.id}>{model.name}</option>)}
    </select></label>{!["input", "output"].includes(selected.type) && <label><input type="checkbox" disabled={busy} checked={selected.on} onChange={event => { const enabled = event.target.checked; void run(async () => { const next = structuredClone(engineRef.current?.getRigPreset() ?? draft); allRigModules(next).find(item => item.id === selected.id)!.on = enabled; await commit(parseRigPreset(next)); }); }} />Enable this gear</label>}</div>
    <button className="secondary" disabled={busy} onClick={() => void run(async () => { if (await commit(resetGearModel(engineRef.current?.getRigPreset() ?? draft, selected.id)) && mounted.current) setMessage("Model defaults restored; this gear’s saved snapshot values and incompatible mappings were cleared."); })}>Reset model defaults</button>
    <p className="model-rig-reference">{modelFor(selected).description} {modelFor(selected).dsp.approximation}</p>
    <ModelControls module={selected} disabled={busy} assets={assets} onChange={changeParameter} />
    <div className="model-rig-toolbar"><label>Category <select aria-label="Gear category" value={category} onChange={event => setCategory(event.target.value as GearCategory | "all")}><option value="all">All gear</option>{Object.entries(GEAR_CATEGORIES).map(([id, label]) => <option key={id} value={id}>{label}</option>)}</select></label>
      <label>Gear library <select aria-label="Model gear library" value={libraryModel.id} onChange={event => setLibraryId(event.target.value)}>{models.map(model => <option key={model.id} value={model.id}>{model.name}</option>)}</select></label>
      <label>Add to <select aria-label="Model gear destination" value={target} onChange={event => setDestination(event.target.value)}>{chains.map(path => <option key={path.id} value={path.id}>{path.name}</option>)}</select></label>
      <button disabled={busy} draggable onDragStart={event => event.dataTransfer.setData("application/x-modulo-model-gear", JSON.stringify({ modelId: libraryModel.id }))} onClick={() => add(libraryModel.id)}>＋ Add selected gear / drag</button></div>
    <div className="model-rig-file"><label>Load rig JSON <input type="file" accept="application/json,.json" disabled={busy} onChange={event => { const file = event.target.files?.[0]; event.currentTarget.value = ""; if (file) void run(async () => {
      if (file.size > 256 * 1024) throw new Error("Rig JSON must be at most 256 KiB."); const next = importRigPreset(await file.text());
      if (!mounted.current) return; const custom = allRigModules(next).find(module => module.type === "cabinet" && module.model === "custom"); if (custom) setIRAssetId(String(custom.parameters.ir_id));
      if (await commit(next) && mounted.current) setMessage("Rig loaded. Missing custom IRs must be imported separately.");
    }); }} /></label>
      <label>IR ID <input type="text" aria-label="Cabinet IR identifier" maxLength={64} value={irAssetId} disabled={busy} onChange={event => setIRAssetId(event.target.value)} /></label>
      <label>Import cabinet IR <input type="file" accept="audio/*" disabled={busy} onChange={event => { const file = event.target.files?.[0]; event.currentTarget.value = ""; if (file) void run(async () => { const audio = engineRef.current; if (!audio) throw new Error("Audio is not ready."); await audio.loadCabinetIR(irAssetId, file); if (mounted.current) { setAssets(audio.listCabinetIRs()); setMessage("IR imported. Select User cabinet IR to use it. Reuse this IR ID when loading its preset."); } }); }} /></label></div>
    <p className="model-rig-status" role="status">{message}</p>
  </section>;
}
