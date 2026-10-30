import test from "node:test";
import assert from "node:assert/strict";
import { AutomaticRigRefinement } from "../src/automaticRigRefinement.ts";
import type { RigGeneration } from "../src/rigGeneration.ts";

const response = (status: RigGeneration["status"] = "ready", request_id = "request-a") => ({ status, request_id }) as RigGeneration;

test("automatic refinement waits for its requested source/response and consumes it once", () => {
  const gate = new AutomaticRigRefinement();
  assert.equal(gate.consume("source-a", response(), 12), undefined); // Reconnect is not a request.
  gate.request("source-a", "request-a");
  assert.equal(gate.consume("source-b", response(), 12), undefined);
  assert.equal(gate.consume("source-a", response("ready", "request-b"), 12), undefined);
  assert.equal(gate.consume("source-a", response("generating"), 12), undefined);
  assert.equal(gate.consume("source-a", response(), 12), "refine");
  assert.equal(gate.consume("source-a", response(), 12), undefined);
  gate.request("source-a", "request-a"); // A deliberate cached Generate may run again.
  assert.equal(gate.consume("source-a", response(), 12), "refine");
});

test("cancel, failed and short responses cannot restart on later polls", () => {
  const gate = new AutomaticRigRefinement();
  gate.request("source-a", "request-a"); gate.cancel();
  assert.equal(gate.consume("source-a", response(), 12), undefined);
  gate.request("source-a", "request-a");
  assert.equal(gate.consume("source-a", response("failed"), 12), undefined);
  assert.equal(gate.consume("source-a", response(), 12), undefined);
  gate.request("source-a", "request-a");
  assert.equal(gate.consume("source-a", response(), 5.99), "short");
  assert.equal(gate.consume("source-a", response(), 12), undefined);
  gate.request("source-a", "request-a");
  assert.equal(gate.consume("source-a", response(), 6), "refine");
});
