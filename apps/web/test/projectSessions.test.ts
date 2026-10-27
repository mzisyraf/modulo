import assert from "node:assert/strict";
import test from "node:test";
import { projectTitle, upsertProject } from "../src/projectSessions.ts";

test("project titles use the local song name without its extension", () => {
  assert.equal(projectTitle("Everlong.demo.wav"), "Everlong.demo");
  assert.equal(projectTitle(), "Untitled Tone Match");
});

test("project updates replace the matching session and keep newest first", () => {
  const projects = upsertProject([
    { id: "one", updatedAt: 1, label: "old" },
    { id: "two", updatedAt: 2, label: "other" },
  ], { id: "one", updatedAt: 3, label: "updated" });

  assert.deepEqual(projects, [
    { id: "one", updatedAt: 3, label: "updated" },
    { id: "two", updatedAt: 2, label: "other" },
  ]);
});
