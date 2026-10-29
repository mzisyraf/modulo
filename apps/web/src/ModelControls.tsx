import { useId, useRef } from "react";
import { modelFor, modelValues, legacyModelOverrides, normalizeModelValue, denormalizeModelValue, type ModelParameter, type RigModule, type Value } from "@modulo/audio";
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

/** All controls are discovered from the selected model; no category knob lists live here. */
export function ModelControls({ module, disabled = false, assets = [], onChange }: ModelControlsProps) {
  const prefix = useId(), model = modelFor(module), values = modelValues(module);
  return <fieldset className="model-controls" disabled={disabled} data-model={model.id}>
    <legend>{model.name} controls</legend>
    <small className="model-control-instructions">Knobs: drag up/down or use arrow keys for fine changes.</small>
    {legacyModelOverrides(module).length > 0 && <p className="model-legacy-note">This saved gear retains legacy adjustments outside this model’s panel. Reset model defaults to use only its current controls.</p>}
    {model.parameters.filter(parameter => !parameter.visibleWhen || values[parameter.visibleWhen.parameter] === parameter.visibleWhen.equals).map(parameter => {
      const id = `${prefix}-${parameter.id}`, value = values[parameter.id], formatted = typeof value === "number" ? `${Number(value.toFixed(2))}${parameter.unit ? ` ${parameter.unit}` : ""}` : String(value);
      return <label className={`model-control model-control-${parameter.widget}`} htmlFor={id} key={`${model.id}:${parameter.id}`}>
        <span className="model-control-name">{parameter.label}</span>
        {parameter.type === "number" ? <>
          {parameter.widget === "knob" ? <ModelKnob parameter={parameter} value={Number(value)} inputId={id} instanceId={module.id} label={`${model.name} ${parameter.label}`} formatted={formatted} disabled={disabled} onChange={value => onChange(parameter.id, value)} /> : <input id={id} data-model-parameter={parameter.id} data-instance={module.id} data-focus={`${module.id}_${parameter.id}`} type="range" min={0} max={1} step={0.001}
            value={normalizeModelValue(parameter, Number(value))} aria-label={`${model.name} ${parameter.label}`} aria-valuetext={formatted}
            onChange={event => onChange(parameter.id, denormalizeModelValue(parameter, Number(event.target.value)))} />}
          <output htmlFor={id}>{formatted}</output>
        </> : parameter.type === "boolean" ? <input id={id} data-model-parameter={parameter.id} data-instance={module.id} data-focus={`${module.id}_${parameter.id}`}
          type="checkbox" role={parameter.widget === "switch" ? "switch" : undefined} checked={Boolean(value)} onChange={event => onChange(parameter.id, event.target.checked)} /> :
          <select id={id} data-model-parameter={parameter.id} data-instance={module.id} data-focus={`${module.id}_${parameter.id}`} value={String(value)} onChange={event => onChange(parameter.id, event.target.value)}>
            {parameter.type === "asset" ? <><option value="none" disabled>Import a cabinet IR first</option>{value !== "none" && !assets.some(asset => asset.id === value) && <option value={String(value)} disabled>Missing IR: {String(value)}</option>}{assets.map(asset => <option value={asset.id} key={asset.id}>{asset.name} ({asset.id})</option>)}</> : parameter.choices.map(choice => <option value={choice.value} key={choice.value}>{choice.label}</option>)}
          </select>}
        {parameter.help && <small>{parameter.help}</small>}
      </label>;
    })}
  </fieldset>;
}
