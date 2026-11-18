import assert from "node:assert/strict";
import { test } from "node:test";
import { bodyProblem, missingFiles, nameProblem, stored } from "./domain.ts";

test("pack files: the five files and derived/<name>.md, and nothing that could name another place", () => {
  for (const name of ["product.md", "audience.md", "claims.md", "constraints.md", "voice.md", "derived/positioning.md", "derived/keywords-de.md"])
    assert.equal(nameProblem(name), null, name);
  for (const name of ["", "notes.md", "voice", "Voice.md", "voice.md/", "../voice.md", "derived/", "derived/Positioning.md", "derived/a/b.md", "derived/../voice.md", "other/positioning.md", `derived/${"a".repeat(49)}.md`])
    assert.match(nameProblem(name) ?? "", /is not a pack file: use product\.md, .* or derived\/<name>\.md/, name);
});

test("a file's text: empty and over 200 000 bytes are refused, with the file and the reason", () => {
  assert.equal(bodyProblem("voice.md", "Plain and warm."), null);
  assert.equal(bodyProblem("voice.md", "x".repeat(200_000)), null, "exactly the limit");
  assert.match(bodyProblem("voice.md", " \n\t") ?? "", /voice\.md has no text/);
  assert.match(bodyProblem("voice.md", "x".repeat(200_001)) ?? "", /voice\.md is over 200000 bytes/);
  assert.match(bodyProblem("voice.md", "\xe9".repeat(100_001)) ?? "", /over 200000 bytes/, "bytes, not characters: 100 001 two-byte letters");
});

test("text is kept with a final newline, so the same words given inline and read from a file are one version", () => {
  assert.equal(stored("Plain and warm."), "Plain and warm.\n");
  assert.equal(stored("Plain and warm.\n"), "Plain and warm.\n");
  assert.equal(stored("a\n\nb\n\n"), "a\n\nb\n\n", "nothing else is changed");
});

test("missing: which of the five files a pack lacks; derived files never stand in for one", () => {
  assert.deepEqual(missingFiles([]), ["product.md", "audience.md", "claims.md", "constraints.md", "voice.md"]);
  assert.deepEqual(missingFiles(["voice.md", "product.md", "derived/voice.md"]), ["audience.md", "claims.md", "constraints.md"]);
  assert.deepEqual(missingFiles(["product.md", "audience.md", "claims.md", "constraints.md", "voice.md"]), []);
});
