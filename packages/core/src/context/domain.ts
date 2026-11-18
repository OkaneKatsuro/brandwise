// The company's context, the "pack": a few files per always-on base (what is sold, to whom, what may be claimed, how the brand
// speaks, how it looks), kept as versions (docs/context-styles-map.md, steps 1 and 3). Pure: no database, no disk. Which files a
// pack has, what their text must be, and which of them a pack still lacks.
import { designProblem } from "./design.ts";

/** The files every pack should have. `derived/<name>.md` holds what is compiled from them (positioning, keywords, messages). */
const PACK_FILES: readonly string[] = ["product.md", "audience.md", "claims.md", "constraints.md", "voice.md"];
/**
 * The company's look: design.md for people and agents, design.json for code (design.ts). A pack may have them and lacks
 * nothing without them: a company whose look was never taken has none.
 */
export const DESIGN_JSON = "design.json";
const LOOK_FILES: readonly string[] = ["design.md", DESIGN_JSON];
const DERIVED = /^derived\/[a-z0-9-]{1,48}\.md$/;
/** A pack file is a brief that agents read whole, so it stays small. */
const MAX_BYTES = 200_000;

/** One version of a pack file, without its text. `confirmedAt` null: a draft, no person has confirmed this version. */
export type DocVersion = { name: string; version: number; author: string; createdAt: string; confirmedAt: string | null; confirmedBy: string | null };
export type Doc = DocVersion & { body: string };

/** Why `name` cannot be a pack file, as a sentence for whoever asked; null when it can. */
export const nameProblem = (name: string): string | null =>
  PACK_FILES.includes(name) || LOOK_FILES.includes(name) || DERIVED.test(name) ? null
    : `"${name}" is not a pack file: use ${[...PACK_FILES, ...LOOK_FILES].join(", ")} or derived/<name>.md (lower-case letters, digits and -)`;

/** Why `body` cannot be the text of the pack file `name`; null when it can. design.json is read by code, so its shape is checked too. */
export const bodyProblem = (name: string, body: string): string | null =>
  body.trim() === "" ? `${name} has no text: a pack file cannot be empty`
    : Buffer.byteLength(body) > MAX_BYTES ? `${name} is over ${MAX_BYTES} bytes: shorten it, a pack file is a brief`
    : name === DESIGN_JSON ? designProblem(body)
    : null;

/** The text as it is kept: with a final newline, so the same words given inline and read from a file are one version, not two. */
export const stored = (body: string): string => (body.endsWith("\n") ? body : `${body}\n`);

/** Which of the five files a pack with these names still lacks. */
export const missingFiles = (names: readonly string[]): string[] => PACK_FILES.filter((f) => !names.includes(f));
