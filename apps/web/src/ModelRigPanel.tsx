import { useEffect, useRef, useState, type RefObject } from "react";
import { createPortal } from "react-dom";
import { AudioEngine, GEAR_CATEGORIES, allRigModules, changeGearModel, resetGearModel, createRigPreset, editRig, exportRigPreset, getGearModels, importRigPreset, modelFor, parameterToDSP, parseRigPreset, type GearCategory, type RigEdit, type RigPreset, type Value } from "@modulo/audio";
import { ModelControls } from "./ModelControls";
import { clearRemovableGear, isRemovableGear, selectionAfterRemoval } from "./modelRigActions";

interface Props { engineRef: RefObject<AudioEngine | null>; value: RigPreset | null }
function initialRig(): RigPreset {
  const rig = createRigPreset("Studio model rig");
  const clean = changeGearModel(rig, "amp", "amp.studio_clean");
  for (const item of clean.chain) if (["overdrive", "gate"].includes(item.type)) item.on = false;
  return clean;
}

const STARTER_RECOMMENDATIONS = new Set(allRigModules(initialRig()).map(module => modelFor(module).id));
const GEAR_MARKS: Record<string, string> = { input: "IN", gate: "GATE", compressor: "COMP", overdrive: "OD", distortion: "DIST", fuzz: "FUZZ", boost: "BOOST", wah: "WAH", amp: "AMP", cabinet: "CAB", eq: "EQ", chorus: "CHOR", flanger: "FLNG", phaser: "PHASE", tremolo: "TREM", delay: "DLY", reverb: "REV", pitch: "PITCH", output: "OUT" };
const GEAR_FAMILIES: Record<string, string> = { amp: "Amplifier", cabinet: "Cabinet", gate: "Noise gate", input: "Input", output: "Output" };
const gearMark = (type: string) => GEAR_MARKS[type] ?? type.slice(0, 5).toUpperCase();
const gearFamily = (type: string) => (GEAR_CATEGORIES as Record<string, string>)[type] ?? GEAR_FAMILIES[type] ?? type;
const LIBRARY_GROUPS = [
  { id: "all", label: "All gear", types: [] },
  { id: "amplifiers", label: "Amplifiers", types: ["amp"] },
  { id: "cabinets", label: "Cabinets", types: ["cabinet"] },
  { id: "drive", label: "Drive", types: ["overdrive", "distortion", "fuzz", "boost", "wah"] },
  { id: "dynamics", label: "Dynamics", types: ["compressor", "gate"] },
  { id: "modulation", label: "Modulation", types: ["chorus", "flanger", "phaser", "tremolo", "pitch"] },
  { id: "delay", label: "Delay", types: ["delay"] },
  { id: "reverb", label: "Reverb", types: ["reverb"] },
  { id: "utilities", label: "Utilities", types: ["eq"] },
] as const;

function GearVisual({ type, label, parameterCount = 3, compact = false }: { type: string; label: string; parameterCount?: number; compact?: boolean }) {
  const count = Math.max(1, Math.min(3, parameterCount));
  if (type === "amp") return <span className={`gear-visual gear-amp${compact ? " is-compact" : ""}`} aria-hidden="true"><i className="gear-amp-handle" /><i className="gear-amp-grille" /><span className="gear-amp-name">{label.replace(/ preamp/i, "")}</span><span className="gear-amp-controls">{Array.from({ length: 7 }, (_, index) => <i key={index} />)}</span></span>;
  if (type === "cabinet") return <span className={`gear-visual gear-cabinet${compact ? " is-compact" : ""}`} aria-hidden="true"><i className="gear-cabinet-grille" /><b>CAB</b></span>;
  return <span className={`gear-visual gear-pedal gear-${type}${compact ? " is-compact" : ""}`} aria-hidden="true"><span className="gear-mini-knobs">{Array.from({ length: count }, (_, index) => <i key={index} />)}</span><b>{gearMark(type)}</b><i className="gear-led" /><i className="gear-footswitch" /></span>;
}

export function ModelRigPanel({ engineRef, value }: Props) {
  const [draft, setDraft] = useState(initialRig), [selectedId, setSelectedId] = useState("amp"), [category, setCategory] = useState<GearCategory | "all">("all");
  const [libraryId, setLibraryId] = useState("delay.single_tap"), [busy, setBusy] = useState(false), [message, setMessage] = useState("Select a pedal or amp to adjust your sound.");
  const [editorOpen, setEditorOpen] = useState(false), [libraryOpen, setLibraryOpen] = useState(false);
  const [libraryGroup, setLibraryGroup] = useState("all"), [search, setSearch] = useState("");
  const [dialog, setDialog] = useState<"clear" | "remove" | "replace" | null>(null), [replacementId, setReplacementId] = useState(""), [replacementSearch, setReplacementSearch] = useState("");
  const [undoRig, setUndoRig] = useState<RigPreset | null>(null), [undoSelectionId, setUndoSelectionId] = useState("");
  const [assets, setAssets] = useState<{ id: string; name: string }[]>(() => engineRef.current?.listCabinetIRs() ?? []), [destination, setDestination] = useState("main");
  const [irAssetId, setIRAssetId] = useState("my_cab"), [rigFileName, setRigFileName] = useState("No rig selected"), [irFileName, setIRFileName] = useState("No IR selected");
  const mounted = useRef(true), urls = useRef(new Set<string>()), actionToken = useRef(0), libraryRef = useRef<HTMLDivElement>(null), selectedCardRef = useRef<HTMLDivElement>(null), previousSelectedId = useRef(selectedId);
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; actionToken.current++; urls.current.forEach(URL.revokeObjectURL); }; }, []);
  useEffect(() => {
    if (previousSelectedId.current !== selectedId) selectedCardRef.current?.scrollIntoView({ behavior: "smooth", block: "nearest", inline: "center" });
    previousSelectedId.current = selectedId;
  }, [selectedId]);
  const rig = value ?? draft, modules = allRigModules(rig), selected = modules.find(item => item.id === selectedId) ?? modules.find(item => item.type === "amp") ?? modules[0];
  const models = getGearModels(category === "all" ? undefined : category).filter(item => !["input", "output"].includes(item.type));
  const libraryModels = [...models].sort((left, right) => Number(STARTER_RECOMMENDATIONS.has(right.id)) - Number(STARTER_RECOMMENDATIONS.has(left.id)) || left.name.localeCompare(right.name));
  const allLibraryModels = getGearModels().filter(item => !["input", "output"].includes(item.type));
  const activeGroup = LIBRARY_GROUPS.find(item => item.id === libraryGroup) ?? LIBRARY_GROUPS[0], query = search.trim().toLocaleLowerCase();
  const visibleLibraryModels = allLibraryModels.filter(model => (!activeGroup.types.length || (activeGroup.types as readonly string[]).includes(model.type)) && (!query || `${model.name} ${model.description} ${gearFamily(model.type)}`.toLocaleLowerCase().includes(query))).sort((left, right) => Number(STARTER_RECOMMENDATIONS.has(right.id)) - Number(STARTER_RECOMMENDATIONS.has(left.id)) || left.name.localeCompare(right.name));
  const libraryModel = libraryModels.find(item => item.id === libraryId) ?? libraryModels[0], selectedModel = modelFor(selected);
  const compatibleModels = getGearModels().filter(model => model.type === selected.type), removable = isRemovableGear(selected.type), removableCount = modules.filter(module => isRemovableGear(module.type)).length;
  const replacementQuery = replacementSearch.trim().toLocaleLowerCase(), visibleReplacements = compatibleModels.filter(model => !replacementQuery || `${model.name} ${model.description} ${gearFamily(model.type)}`.toLocaleLowerCase().includes(replacementQuery));
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
  function edit(operation: RigEdit, success = "Rig updated. All exposed controls belong to the selected model.") { void run(async () => { if (await commit(editRig(engineRef.current?.getRigPreset() ?? draft, operation))) { if (operation.action !== "remove") setSelectedId(operation.id); setMessage(success); } }); }
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
    edit({ action: "add", id: `gear_${crypto.randomUUID().replaceAll("-", "")}`, type: info.type, model: info.model, target: path, before, irId: assets[0]?.id }, `${info.name} added to ${chains.find(chain => chain.id === path)?.name ?? "the rig"}.`);
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
  const applyRig = () => void run(async () => { const audio = engineRef.current; if (!audio) throw new Error("Audio is not ready yet."); if (await audio.applyRigPreset(rig)) { setDraft(rig); setMessage("Rig applied. Model rig active for audition and live input."); } });
  function openReplace() {
    setReplacementId(selectedModel.id); setReplacementSearch(""); setDialog("replace");
  }
  function replaceModel() {
    if (!replacementId || replacementId === selectedModel.id) return;
    void run(async () => {
      const next = changeGearModel(engineRef.current?.getRigPreset() ?? draft, selected.id, replacementId, assets[0]?.id);
      if (await commit(next)) { setDialog(null); setMessage(`${modelFor(allRigModules(next).find(module => module.id === selected.id)!).name} replaced ${selectedModel.name} without moving the gear.`); }
    });
  }
  function removeSelected() {
    if (!removable) return;
    void run(async () => {
      const before = engineRef.current?.getRigPreset() ?? draft, next = editRig(before, { action: "remove", id: selected.id });
      const nextSelection = selectionAfterRemoval(before, next, selected.id);
      if (await commit(next)) { setUndoRig(before); setUndoSelectionId(selected.id); setSelectedId(nextSelection); setDialog(null); setMessage(`${selectedModel.name} removed. You can undo this change until the next destructive action.`); }
    });
  }
  function clearRig() {
    void run(async () => {
      const before = engineRef.current?.getRigPreset() ?? draft, next = clearRemovableGear(before);
      if (await commit(next)) { setUndoRig(before); setUndoSelectionId(selected.id); setSelectedId(next.chain[0].id); setDialog(null); setMessage("Rig cleared to the required Input and Output routing. Add any supported gear from the library."); }
    });
  }
  function undoDestructiveChange() {
    if (!undoRig) return;
    void run(async () => {
      if (await commit(undoRig)) { setSelectedId(allRigModules(undoRig).some(module => module.id === undoSelectionId) ? undoSelectionId : undoRig.chain[0].id); setUndoRig(null); setUndoSelectionId(""); setMessage("Previous rig restored."); }
    });
  }

  function openLibrary() {
    setLibraryOpen(true);
    window.setTimeout(() => libraryRef.current?.scrollIntoView({ behavior: "smooth", block: "start" }), 0);
  }

  return <section className="model-rig-panel" aria-labelledby="model-rig-title">
    <header className="model-rig-heading">
      <div className="model-rig-title"><span className="model-rig-kicker">MODEL RIG</span><h2 id="model-rig-title">Build your signal chain.</h2><p>Your sound, pedal by pedal. Select gear to fine-tune it.</p></div>
      <div className="model-rig-action-area"><div className="model-rig-primary-actions"><button disabled={busy} title="Activate this edited chain for audition and live input" onClick={applyRig}>Apply Rig</button>
        <button className="secondary" disabled={busy} title="Download this rig as a JSON file" onClick={save}>Export Rig</button><button className="model-rig-danger" disabled={busy || removableCount === 0} title={removableCount ? "Remove all optional gear" : "This rig already contains only required routing"} onClick={() => setDialog("clear")}>Clear Rig</button></div></div>
      <span className="model-rig-mode"><i />{value ? "Rig active" : "Ready to edit"}</span>
    </header>

    <section className="model-rig-workbench-section" aria-labelledby="model-rig-chain-title">
      <div className="model-rig-section-heading"><div><span className="model-rig-kicker">SIGNAL CHAIN</span><h3 id="model-rig-chain-title">Current chain</h3></div><p>Drag to reorder. Scroll sideways for more. Select a module to edit it.</p><button className="model-rig-add-gear" onClick={openLibrary}>＋ Add gear</button></div>
      {removableCount === 0 && <div className="model-rig-empty-chain"><span aria-hidden="true">＋</span><div><h4>Build your rig from scratch</h4><p>Your signal chain is ready. Add an amplifier, pedal, cabinet, or effect from the Gear Library. Required Input and Output routing stays in place.</p></div><button onClick={openLibrary}>Add Gear</button></div>}
      {chains.map(path => <div className="model-rig-path" key={path.id}><span className="model-rig-path-label"><span>{path.name}</span><small>{path.chain.length} modules</small></span><div className="model-rig-chain" tabIndex={0} onDragOver={dragOver} onDrop={event => onDrop(event, path.id)} aria-label={`${path.name} signal chain. Scroll horizontally for more modules.`}>
        {path.chain.map((module, index) => { const model = modelFor(module); return <div ref={module.id === selected.id ? selectedCardRef : undefined} className={`model-rig-card gear-stage-${module.type}${module.id === selected.id ? " is-selected" : ""}${module.on ? "" : " is-bypassed"}`} key={module.id} data-rig-instance={module.id} onDragOver={dragOver} onDrop={event => onDrop(event, path.id, module.id)}>
          <button className="model-rig-card-select" onClick={() => { setSelectedId(module.id); setEditorOpen(true); }} aria-pressed={module.id === selected.id}><span className="gear-jack gear-jack-in" /><GearVisual type={module.type} label={model.name} parameterCount={model.parameters.length} /><span className="gear-jack gear-jack-out" /><span className="model-rig-card-copy"><strong>{model.name}</strong><small>{gearFamily(module.type)}</small><span className="model-rig-card-state"><i />{module.on ? "Enabled" : "Bypassed"}</span></span></button>
          {isRemovableGear(module.type) && <div className="model-rig-card-actions"><button disabled={busy} draggable onDragStart={event => { event.dataTransfer.setData("application/x-modulo-model-gear", JSON.stringify({ instanceId: module.id })); event.currentTarget.closest(".model-rig-card")?.classList.add("is-dragging"); }} onDragEnd={event => event.currentTarget.closest(".model-rig-card")?.classList.remove("is-dragging")} onClick={() => { setSelectedId(module.id); setEditorOpen(true); }} aria-label={`Drag ${module.id}`} title="Drag to reorder">⠿</button>
            <button disabled={busy || index <= (path.id === "main" ? 1 : 0)} onClick={() => edit({ action: "move", id: module.id, target: path.id, before: path.chain[index - 1]?.id })} aria-label={`Move ${module.id} earlier`} title="Move earlier">←</button>
            <button disabled={busy || index >= path.chain.length - (path.id === "main" ? 2 : 1)} onClick={() => edit({ action: "move", id: module.id, target: path.id, before: path.chain[index + 2]?.id })} aria-label={`Move ${module.id} later`} title="Move later">→</button>
            <button disabled={busy} onClick={() => { setSelectedId(module.id); setDialog("remove"); }} aria-label={`Remove ${module.id}`} title="Remove from rig">×</button></div>}
        </div>; })}
        <button className="model-rig-add-slot" onClick={openLibrary}><span>＋</span>Add effect</button>
      </div></div>)}
    </section>

    <div className="rig-editor-toolbar"><button className="secondary" aria-expanded={editorOpen} onClick={() => setEditorOpen(value => !value)}>{editorOpen ? "Close gear controls" : "Edit selected gear"}</button></div>
    <div className="model-rig-main-grid guided-rig-grid">
      <section hidden={!editorOpen} className="model-rig-selected-panel" aria-labelledby="model-rig-selected-title">
        <div className="model-rig-selected-heading"><GearVisual type={selected.type} label={selectedModel.name} parameterCount={selectedModel.parameters.length} compact /><div><span className="model-rig-kicker">SELECTED GEAR</span><h3 id="model-rig-selected-title">{selectedModel.name}</h3><p>{selectedModel.description}</p></div><span className="model-rig-family">{gearFamily(selected.type)}</span></div>
        <div className="model-rig-selected-actions">
          {removable ? <label className="model-rig-enable switch-control"><span className="switch-control-copy"><strong>Gear enabled</strong><small id={`gear-enable-status-${selected.id}`} aria-live="polite">{selected.on ? "Active in signal chain" : "Bypassed"}</small></span><input className="modulo-switch" type="checkbox" role="switch" aria-describedby={`gear-enable-status-${selected.id}`} disabled={busy} checked={selected.on} onChange={event => { const enabled = event.target.checked; void run(async () => { const next = structuredClone(engineRef.current?.getRigPreset() ?? draft); allRigModules(next).find(item => item.id === selected.id)!.on = enabled; await commit(parseRigPreset(next)); }); }} /></label> : <div className="model-rig-routing-lock"><strong>Required routing</strong><small>Input and Output cannot be bypassed or removed.</small></div>}
          <button disabled={busy || compatibleModels.length < 2} title={compatibleModels.length < 2 ? "No other compatible models are available" : `Replace ${selectedModel.name}`} onClick={openReplace}>↻ Replace Model</button>
          <button className="secondary" disabled={busy} onClick={() => void run(async () => { if (await commit(resetGearModel(engineRef.current?.getRigPreset() ?? draft, selected.id)) && mounted.current) setMessage("Model defaults restored; this gear’s saved snapshot values and incompatible mappings were cleared."); })}>Reset Defaults</button>
          <button className="model-rig-danger" disabled={busy || !removable} title={removable ? `Remove ${selectedModel.name}` : "Required Input and Output routing cannot be removed"} onClick={() => setDialog("remove")}>Remove Gear</button>
        </div>
        <ModelControls module={selected} disabled={busy} assets={assets} onChange={changeParameter} />
        <details className="model-rig-reference"><summary>About this gear</summary>{selectedModel.dsp.approximation}</details>
      </section>

      <section hidden={!libraryOpen} className="model-rig-library" ref={libraryRef} aria-labelledby="model-rig-library-title">
        <div className="model-rig-library-heading"><div><span className="model-rig-kicker">GEAR LIBRARY</span><h3 id="model-rig-library-title">Find your next pedal</h3><button className="text-action" onClick={() => setLibraryOpen(false)}>Close library</button></div><label className="model-rig-search"><span aria-hidden="true">⌕</span><input type="search" value={search} onChange={event => setSearch(event.target.value)} placeholder="Search models…" aria-label="Search gear models" /></label></div>
        <div className="model-rig-filters" role="group" aria-label="Filter gear library">{LIBRARY_GROUPS.map(group => <button className={libraryGroup === group.id ? "is-active" : ""} aria-pressed={libraryGroup === group.id} key={group.id} onClick={() => setLibraryGroup(group.id)}>{group.label}</button>)}</div>
        {chains.length > 1 && <label className="model-rig-destination"><span>Add gear to</span><select aria-label="Model gear destination" value={target} onChange={event => setDestination(event.target.value)}>{chains.map(path => <option key={path.id} value={path.id}>{path.name}</option>)}</select></label>}
        <div className="model-rig-library-grid" aria-label="All available gear">
          {visibleLibraryModels.map(model => { const present = modules.some(module => modelFor(module).id === model.id); return <article className={`model-library-card${model.id === libraryId ? " is-selected" : ""}`} key={model.id} draggable onDragStart={event => { event.dataTransfer.setData("application/x-modulo-model-gear", JSON.stringify({ modelId: model.id })); event.currentTarget.classList.add("is-dragging"); }} onDragEnd={event => event.currentTarget.classList.remove("is-dragging")}>
            <button className="model-library-select" onClick={() => setLibraryId(model.id)} aria-pressed={model.id === libraryId}><span className="model-library-visual"><GearVisual type={model.type} label={model.name} parameterCount={model.parameters.length} compact /></span><span className="model-library-copy"><span><small>{gearFamily(model.type)}</small>{present && <em>In rig</em>}</span><strong>{model.name}</strong><span>{model.description}</span></span>{STARTER_RECOMMENDATIONS.has(model.id) && <span className="model-library-recommended">★ Starter</span>}</button>
            <button className="model-library-add" disabled={busy} onClick={() => add(model.id)} aria-label={`${present ? "Add another" : "Add"} ${model.name} to ${chains.find(path => path.id === target)?.name ?? "chain"}`}>{present ? "＋ Add another" : "＋ Add to rig"}</button>
          </article>; })}
          {!visibleLibraryModels.length && <p className="model-rig-empty">No gear matches “{search}”. Try another name or category.</p>}
        </div>
        <div className="model-rig-compat-controls" aria-hidden="true"><label>Category <select aria-label="Gear category" value={category} onChange={event => setCategory(event.target.value as GearCategory | "all")}><option value="all">All gear</option>{Object.entries(GEAR_CATEGORIES).map(([id, label]) => <option key={id} value={id}>{label}</option>)}</select></label><label>Gear library <select aria-label="Model gear library" value={libraryModel.id} onChange={event => setLibraryId(event.target.value)}>{libraryModels.map(model => <option key={model.id} value={model.id}>{model.name}</option>)}</select></label><label>Add to <select aria-label="Model gear destination" value={target} onChange={event => setDestination(event.target.value)}>{chains.map(path => <option key={path.id} value={path.id}>{path.name}</option>)}</select></label><button disabled={busy} onClick={() => add(libraryModel.id)}>＋ Add selected gear / drag</button></div>
      </section>
    </div>

    <footer className="model-rig-footer"><details className="model-rig-files"><summary>Rig files and custom cabinet IRs</summary><div className="model-rig-import-grid">
      <label className="model-rig-upload-card"><input className="model-rig-file-input" type="file" accept="application/json,.json" disabled={busy} onChange={event => { const file = event.target.files?.[0]; event.currentTarget.value = ""; if (file) { setRigFileName(file.name); void run(async () => { if (file.size > 256 * 1024) throw new Error("Rig JSON must be at most 256 KiB."); const next = importRigPreset(await file.text()); if (!mounted.current) return; const custom = allRigModules(next).find(module => module.type === "cabinet" && module.model === "custom"); if (custom) setIRAssetId(String(custom.parameters.ir_id)); if (await commit(next) && mounted.current) setMessage(`${file.name} imported. Missing custom IRs must be loaded separately.`); }); } }} /><span className="model-rig-upload-icon">⇩</span><span><strong>Import Rig</strong><small>Load a Modulo rig JSON file · maximum 256 KiB</small><em>{rigFileName}</em></span><b>Choose file</b></label>
      <div className="model-rig-upload-card model-rig-ir-card"><span className="model-rig-upload-icon">◫</span><span><strong>Import Cabinet IR</strong><small>Load an audio impulse response under a reusable local ID</small><label className="model-rig-ir-id">IR identifier<input type="text" aria-label="Cabinet IR identifier" maxLength={64} value={irAssetId} disabled={busy} onChange={event => setIRAssetId(event.target.value)} /></label><em>{irFileName}</em></span><label className="model-rig-file-button">Choose file<input className="model-rig-file-input" type="file" accept="audio/*" disabled={busy} onChange={event => { const file = event.target.files?.[0]; event.currentTarget.value = ""; if (file) { setIRFileName(file.name); void run(async () => { const audio = engineRef.current; if (!audio) throw new Error("Audio is not ready."); await audio.loadCabinetIR(irAssetId, file); if (mounted.current) { setAssets(audio.listCabinetIRs()); setMessage(`${file.name} imported as ${irAssetId}. Select User cabinet IR to use it.`); } }); } }} /></label></div>
    </div></details><p className="model-rig-status" role="status">{message}{undoRig && <button className="model-rig-undo" disabled={busy} onClick={undoDestructiveChange}>Undo</button>}</p></footer>
    {dialog && createPortal(<div className="model-rig-dialog-backdrop" onMouseDown={event => { if (event.target === event.currentTarget && !busy) setDialog(null); }} onKeyDown={event => { if (event.key === "Escape" && !busy) setDialog(null); }}>
      <section className={`model-rig-dialog${dialog === "replace" ? " is-replace" : ""}`} role="dialog" aria-modal="true" aria-labelledby="model-rig-dialog-title">
        {dialog === "clear" && <><span className="model-rig-dialog-icon is-danger" aria-hidden="true">!</span><h3 id="model-rig-dialog-title">Clear your rig?</h3><p>This will remove all equipment from the current signal chain. You can add new gear from the Gear Library.</p><p className="model-rig-dialog-note">Modulo keeps the mandatory Input and Output routing required by the audio engine.</p><div className="model-rig-dialog-actions"><button className="secondary" disabled={busy} autoFocus onClick={() => setDialog(null)}>Cancel</button><button className="model-rig-danger is-filled" disabled={busy} onClick={clearRig}>Clear Rig</button></div></>}
        {dialog === "remove" && <><span className="model-rig-dialog-icon is-danger" aria-hidden="true">×</span><h3 id="model-rig-dialog-title">Remove {selectedModel.name}?</h3><p>This removes only the selected {gearFamily(selected.type).toLocaleLowerCase()} and keeps the rest of your signal chain unchanged.</p><div className="model-rig-dialog-actions"><button className="secondary" disabled={busy} autoFocus onClick={() => setDialog(null)}>Cancel</button><button className="model-rig-danger is-filled" disabled={busy || !removable} onClick={removeSelected}>Remove Gear</button></div></>}
        {dialog === "replace" && <><div className="model-rig-dialog-heading"><div><span className="model-rig-kicker">REPLACE MODEL</span><h3 id="model-rig-dialog-title">Choose a compatible {gearFamily(selected.type).toLocaleLowerCase()}</h3><p>The gear stays in the same signal-chain position. New model defaults replace incompatible settings.</p></div><button className="model-rig-dialog-close" aria-label="Close replacement dialog" disabled={busy} onClick={() => setDialog(null)}>×</button></div><label className="model-rig-replace-search"><span aria-hidden="true">⌕</span><input autoFocus type="search" value={replacementSearch} onChange={event => setReplacementSearch(event.target.value)} placeholder="Search compatible models…" aria-label="Search compatible replacement models" /></label><div className="model-rig-replacement-grid" role="radiogroup" aria-label="Compatible replacement models">{visibleReplacements.map(model => <button className={`model-rig-replacement${replacementId === model.id ? " is-selected" : ""}`} role="radio" aria-checked={replacementId === model.id} key={model.id} onClick={() => setReplacementId(model.id)}><GearVisual type={model.type} label={model.name} parameterCount={model.parameters.length} compact /><span><small>{gearFamily(model.type)}</small><strong>{model.name}</strong><span>{model.description}</span>{model.id === selectedModel.id && <em>Current model</em>}</span></button>)}</div>{visibleReplacements.length === 0 && <p className="model-rig-replacement-empty">No compatible models match that search.</p>}<div className="model-rig-dialog-actions"><button className="secondary" disabled={busy} onClick={() => setDialog(null)}>Cancel</button><button disabled={busy || !replacementId || replacementId === selectedModel.id} onClick={replaceModel}>Replace Model</button></div></>}
      </section>
    </div>, document.body)}
  </section>;
}
