// What an asset records about the generation that made it. One shape for every provider, written when the result is collected:
// the map reads the style and the prompt from it, and the numbers per style are counted by it.
import type { LookRef } from "../context/design.ts";
import type { StyleRef } from "../styles/domain.ts";
import type { GenSpec } from "./index.ts";

/** A generation as it was started: by which provider, as which job, asked with what, at which estimated cost, in which style and look. */
type Generation = { provider: string; jobId: string; spec: GenSpec; credits: number; style?: StyleRef; look?: LookRef | null };

/**
 * The provenance of a generated asset. `prompt` is the whole prompt the provider was asked with, the company's look included;
 * `style` and `look` say which recipe and which version of the pack's design.json went into it, null when none did.
 */
export const generationProvenance = (g: Generation) => ({
  tool: g.provider, model: g.spec.model, jobId: g.jobId, prompt: g.spec.prompt, aspect: g.spec.aspect ?? null, resolution: g.spec.resolution ?? null,
  refs: (g.spec.refs ?? []).map((ref) => ref.split("/").pop()), creditsEstimated: g.credits, style: g.style ?? null, look: g.look ?? null,
});
