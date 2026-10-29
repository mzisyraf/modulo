import { useId, useRef } from "react";
import { modelFor, modelValues, legacyModelOverrides, normalizeModelValue, denormalizeModelValue, type ModelParameter, type RigModule, type Value } from "@modulo/audio";
import { ChoiceMenu } from "./ChoiceMenu";
import "./modelRig.css";

export interface ModelControlsProps {
  module: RigModule;
  disabled?: boolean;
  assets?: { id: string; name: string }[];
  onChange: (parameter: string, value: Value) => void;
}

function ModelKnob({ parameter, value, inputId, instanceId, label, formatted, disabled, onChange }: { parameter: ModelParameter; value: number; inputId: string; instanceId: string; label: string; formatted: string; disabled: boolean; onChange: (value: number) => void }) {
  const drag = useRef<{ pointer: number; x: number; y: number; value: number } | null>(null), input = useRef<HTMLInputElement>(null), normalized = normalizeModelValue(parameter, value);
  return <span className="model-knob-wrapper" onPointerDown={event => {
    if (disabled || event.button !== 0) return; event.preventDefault(); input.current?.focus({ preventScroll: true });
    drag.current = { pointer: event.pointerId, x: event.clientX, y: event.clientY, value: normalized }; event.currentTarget.setPointerCapture(event.pointerId);
  }} onPointerMove={event => {
    const start = drag.current; if (!start || start.pointer !== event.pointerId) return;
    const position = Math.max(0, Math.min(1, start.value + (start.y - event.clientY) / 180 + (event.clientX - start.x) / 360));
    onChange(denormalizeModelValue(parameter, position));
  }} onPointerUp={event => { drag.current = null; if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId); }} onPointerCancel={() => { drag.current = null; }} onLostPointerCapture={() => { drag.current = null; }}>
    <span className="model-knob" aria-hidden="true"><i style={{ transform: `rotate(${-135 + 270 * normalized}deg)` }} /></span>
    <input ref={input} className="model-knob-input" id={inputId} data-model-parameter={parameter.id} data-instance={instanceId} data-focus={`${instanceId}_${parameter.id}`} type="range" min={0} max={1} step={0.001}
      value={normalized} aria-label={label} aria-valuetext={formatted} onChange={event => onChange(denormalizeModelValue(parameter, Number(event.target.value)))} />
  </span>;
}

const CONTROL_GROUPS: Partial<Record<RigModule["type"], { label: string; ids: string[] }[]>> = {
  cabinet: [
    { label: "Mic 1", ids: ["mic", "position", "distance"] },
    { label: "Mic 2", ids: ["mic2", "mic2_position", "mic2_distance", "mic_blend", "mic2_delay_ms", "mic2_invert"] },
    { label: "Output & EQ", ids: ["ir_id", "low_cut_hz", "high_cut_hz", "mix", "level_db"] },
  ],
  compressor: [
    { label: "Dynamics", ids: ["threshold_db", "ratio", "knee_db", "sustain", "punch"] },
    { label: "Timing & output", ids: ["attack_ms", "release_ms", "makeup_db", "level_db", "mix"] },
  ],
  amp: [
    { label: "Gain staging", ids: ["volume_db", "input_drive", "gain", "master_db"] },
    { label: "Tone", ids: ["bass_db", "mid_db", "treble_db", "presence_db", "resonance_db", "bright"] },
  ],
  eq: [
    { label: "Filters", ids: ["low_cut_hz", "high_cut_hz"] },
    { label: "Tone shaping", ids: ["bass_db", "mid_hz", "mid_q", "mid_db", "treble_db", "tilt_db", "pivot_hz"] },
  ],
};

function groupsFor(module: RigModule, parameters: ModelParameter[]) {
  const configured = CONTROL_GROUPS[module.type] ?? [], used = new Set(configured.flatMap(group => group.ids));
  const groups = configured.map(group => ({ label: group.label, parameters: parameters.filter(parameter => group.ids.includes(parameter.id)) })).filter(group => group.parameters.length);
  const remaining = parameters.filter(parameter => !used.has(parameter.id));
  if (remaining.length) groups.push({ label: groups.length ? "Other controls" : "Controls", parameters: remaining });
  return groups;
}

function numberStep(parameter: ModelParameter) {
  if (parameter.type !== "number") return 1;
  const range = (parameter.max ?? 1) - (parameter.min ?? 0);
  if (range <= 2) return .01;
  if (range <= 20) return .1;
  return 1;
}

/** All controls are discovered from the selected model; no category knob lists live here. */
export function ModelControls({ module, disabled = false, assets = [], onChange }: ModelControlsProps) {
  const prefix = useId(), model = modelFor(module), values = modelValues(module);
  const visibleParameters = model.parameters.filter(parameter => !parameter.visibleWhen || values[parameter.visibleWhen.parameter] === parameter.visibleWhen.equals), groups = groupsFor(module, visibleParameters);
  return <fieldset className="model-controls" disabled={disabled} data-model={model.id}>
    <legend>{model.name} controls</legend>
    <small className="model-control-instructions">Drag knobs, use arrow keys, or enter an exact value.</small>
    {legacyModelOverrides(module).length > 0 && <p className="model-legacy-note">This saved gear retains legacy adjustments outside this model’s panel. Reset model defaults to use only its current controls.</p>}
    <div className="model-control-groups">{groups.map(group => <section className="model-control-group" key={group.label}><h4>{group.label}</h4><div className="model-control-group-grid">{group.parameters.map(parameter => {
        const id = `${prefix}-${parameter.id}`, value = values[parameter.id], formatted = typeof value === "number" ? `${Number(value.toFixed(2))}${parameter.unit ? ` ${parameter.unit}` : ""}` : String(value), minimum = parameter.min ?? 0, maximum = parameter.max ?? 1;
        return <label className={`model-control model-control-${parameter.widget}`} htmlFor={id} key={`${model.id}:${parameter.id}`}>
          <span className="model-control-name">{parameter.label}</span>
          {parameter.type === "number" ? <>
            {parameter.widget === "knob" ? <ModelKnob parameter={parameter} value={Number(value)} inputId={id} instanceId={module.id} label={`${model.name} ${parameter.label}`} formatted={formatted} disabled={disabled} onChange={value => onChange(parameter.id, value)} /> : <input id={id} data-model-parameter={parameter.id} data-instance={module.id} data-focus={`${module.id}_${parameter.id}`} type="range" min={0} max={1} step={0.001} value={normalizeModelValue(parameter, Number(value))} aria-label={`${model.name} ${parameter.label}`} aria-valuetext={formatted} onChange={event => onChange(parameter.id, denormalizeModelValue(parameter, Number(event.target.value)))} />}
            <span className="model-control-precise"><input type="number" min={minimum} max={maximum} step={numberStep(parameter)} value={Number(value)} aria-label={`${model.name} ${parameter.label} exact value`} onChange={event => { const next = Number(event.target.value); if (Number.isFinite(next)) onChange(parameter.id, Math.max(minimum, Math.min(maximum, next))); }} /><span>{parameter.unit}</span></span>
            <output htmlFor={id}>{formatted}</output>
          </> : parameter.type === "boolean" ? <input id={id} data-model-parameter={parameter.id} data-instance={module.id} data-focus={`${module.id}_${parameter.id}`} type="checkbox" role={parameter.widget === "switch" ? "switch" : undefined} checked={Boolean(value)} onChange={event => onChange(parameter.id, event.target.checked)} /> : parameter.type === "asset" ?
            <select id={id} data-model-parameter={parameter.id} data-instance={module.id} data-focus={`${module.id}_${parameter.id}`} value={String(value)} onChange={event => onChange(parameter.id, event.target.value)}><option value="none" disabled>Import a cabinet IR first</option>{value !== "none" && !assets.some(asset => asset.id === value) && <option value={String(value)} disabled>Missing IR: {String(value)}</option>}{assets.map(asset => <option value={asset.id} key={asset.id}>{asset.name} ({asset.id})</option>)}</select> :
            <ChoiceMenu id={id} value={String(value)} disabled={disabled} onChange={next => onChange(parameter.id, next)} options={parameter.choices.map(choice => ({ label: choice.label, value: choice.value }))} placeholder={`Choose ${parameter.label.toLocaleLowerCase()}`} />}
          {parameter.help && <small>{parameter.help}</small>}
        </label>;
      })}</div></section>)}</div>
  </fieldset>;
}
