import test from "node:test";
import assert from "node:assert/strict";
import { AutomaticRigRefinement } from "../src/automaticRigRefinement.ts";

test("only explicit acknowledged responses refine, once across polling and reconnect", () => {
  const gate = new AutomaticRigRefinement();
  assert.equal(gate.consume("source", "old", "ready", 12), undefined);
  const ticket = gate.begin("source", true);
  assert.equal(gate.consume("source", "ready-before-post", "ready", 12), undefined);
  assert.equal(gate.acknowledge(ticket, "source", "current"), true);
  assert.equal(gate.consume("source", "old", "ready", 12), undefined);
  assert.equal(gate.consume("source", "current", "generating", 12), undefined);
  assert.equal(gate.consume("source", "current", "ready", 12), "refine");
  assert.equal(gate.consume("source", "current", "ready", 12), undefined);
  const cached = gate.begin("source", true);
  gate.acknowledge(cached, "source", "current");
  assert.equal(gate.consume("source", "current", "ready", 12), "refine");
});

test("cancellation and new source/request reject late work without retry", () => {
  const gate = new AutomaticRigRefinement(), old = gate.begin("old source", true);
  gate.cancel();
  assert.equal(gate.acknowledge(old, "old source", "late"), false);
  const current = gate.begin("new source", true);
  assert.equal(gate.acknowledge(old, "old source", "late"), false);
  assert.equal(gate.acknowledge(current, "wrong source", "new"), false);
  assert.equal(gate.acknowledge(current, "new source", "new"), true);
  assert.equal(gate.consume("old source", "new", "ready", 12), undefined);
  gate.cancel();
  assert.equal(gate.consume("new source", "new", "ready", 12), undefined);
});

test("opt-out, short sources and failed responses consume their opportunity", () => {
  const gate = new AutomaticRigRefinement();
  for (const [enabled, status, duration, expected] of [
    [false, "ready", 12, "manual"], [true, "ready", 5.9, "short"],
    [true, "ready", NaN, "short"], [true, "failed", 12, undefined], [true, "ready", 6, "refine"],
  ] as const) {
    const ticket = gate.begin("source", enabled);
    gate.acknowledge(ticket, "source", "request");
    assert.equal(gate.consume("source", "request", status, duration), expected);
    assert.equal(gate.consume("source", "request", "ready", 12), undefined);
  }
});
