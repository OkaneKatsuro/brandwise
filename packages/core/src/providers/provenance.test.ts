import assert from "node:assert/strict";
import { test } from "node:test";
import { generationProvenance } from "./provenance.ts";

test("a generated asset records what made it: provider, model, job, the whole prompt, media by name, cost, the style, and the version of the company's look that was applied", () => {
  const spec = { model: "nano_banana_pro", prompt: "Brand palette: background #ffffff, text #14161a, primary #1f6feb. A widget on a desk.", aspect: "4:5", resolution: "2k", refs: ["/tmp/uploads/sheet.png", "9d2f6f0e-6a55-4d5c-9c11-1f0c2a6d7e88"] };
  assert.deepEqual(generationProvenance({ provider: "higgsfield", jobId: "job-1", spec, credits: 2, style: { id: "product-hero", version: 1, origin: "built-in" }, look: { version: 3 } }), {
    tool: "higgsfield", model: "nano_banana_pro", jobId: "job-1", prompt: spec.prompt, aspect: "4:5", resolution: "2k", refs: ["sheet.png", "9d2f6f0e-6a55-4d5c-9c11-1f0c2a6d7e88"], creditsEstimated: 2,
    style: { id: "product-hero", version: 1, origin: "built-in" }, look: { version: 3 },
  });
});

test("a generation without a style or without the company's look records null for it, never nothing", () => {
  const made = generationProvenance({ provider: "higgsfield", jobId: "job-2", spec: { model: "veo3_1", prompt: "A widget turns slowly." }, credits: 32 });
  assert.deepEqual([made.style, made.look, made.aspect, made.resolution, made.refs], [null, null, null, null, []]);
  assert.equal(generationProvenance({ provider: "higgsfield", jobId: "job-3", spec: { model: "veo3_1", prompt: "x" }, credits: 1, look: null }).look, null, "left out with --no-brand, or a look no person confirmed");
});
