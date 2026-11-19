// Style recipes (docs/context-styles-map.md, step 5). A style describes one kind of creative as data and is shared by every company:
// code renders it into the fields of a generation, the caller supplies only the slots. No database, no network: the shape of a
// style, its validation, its rendering, and the generation that names one.
import Mustache from "mustache";
import { MAX_PROMPT, MODEL_ID, type GenSpec } from "../providers/index.ts";

export const STYLE_KINDS = ["image", "video"] as const;

export type Style = {
  /** What the style is called. A style of a pack is listed and used under its address, `<pack>/<id>`. */
  id: string;
  title: string;
  kind: (typeof STYLE_KINDS)[number];
  /** Aspect ratios the composition holds in; the first is the default. */
  aspects: string[];
  /** Calendar channels the format suits. */
  channels: string[];
  /** What the caller fills in: slot name -> what it should hold. Every slot is required. */
  slots: Record<string, string>;
  /** Mustache template over the slots. Slot values are plain text and are inserted as written. */
  prompt: string;
  /** The model per provider id. A provider without an entry needs the model named on each call. */
  models?: Record<string, string>;
  /** Parameters of the model (duration, sound...), by name. */
  params?: Record<string, string>;
  /** Raised with every change of the recipe, so results can be compared by the recipe that made them. */
  version: number;
  /** When to use the style. */
  use: string;
  /** The pattern of the post text that goes with it: opening line, structure. */
  copy: string;
  /** What to avoid, in the creative and in using the style. */
  avoid: string;
};

const FIELDS = ["id", "title", "kind", "aspects", "channels", "slots", "prompt", "models", "params", "version", "use", "copy", "avoid"];
/** How a style's id and a pack's name are written: the two parts of the address `<pack>/<id>`. */
export const STYLE_ID = /^[a-z][a-z0-9]*(-[a-z0-9]+)*$/;
const NAME = /^[a-z][a-z0-9_]*$/;
const ASPECT = /^[1-9]\d?:[1-9]\d?$/;
/** Mustache tags a prompt may not use, by the token type the parser gives them. */
const OTHER_TAGS: Record<string, string> = { "#": "a section", "^": "an inverted section", ">": "a partial", "!": "a comment", "=": "a change of delimiters" };

/** Characters that end a line, steer a terminal or cannot be stored: control characters and halves of a character. */
const CONTROL = /[\p{Cc}\p{Cs}\u2028\u2029]/u;

export const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);
/** Text as a style and a pack hold it: not empty and on one line. Whatever shows it, a list or a terminal, shows it as written. */
export const isText = (v: unknown): v is string => typeof v === "string" && v.trim() !== "" && !CONTROL.test(v);
/** A record of texts under names of ours (a slot, a provider, a parameter): the names are shown and stored too. */
const isTextRecord = (v: unknown): v is Record<string, string> => isRecord(v) && Object.entries(v).every(([name, text]) => NAME.test(name) && isText(text));
/** Words that come from outside (a file's name, an error of a parser or of git) inside a message of ours: on one line and cut. */
export const plain = (text: string) => text.replaceAll(new RegExp(CONTROL, "gu"), " ").slice(0, 300);
/** The same, quoted: nothing in it can pass for our own words. */
export const quoted = (text: string) => JSON.stringify(plain(text));
const isList = (v: unknown, item: RegExp): v is string[] => Array.isArray(v) && v.length > 0 && v.every((x) => typeof x === "string" && item.test(x));

/** What is wrong with a prompt as a template over these slots: it may only insert them, and it must insert each. */
function promptProblems(prompt: string, slots: string[]): string[] {
  let tags: [string, string][];
  try {
    tags = Mustache.parse(prompt).filter(([type]) => type !== "text").map(([type, name]) => [type, name]);
  } catch (cause) {
    return [`prompt is not a valid Mustache template: ${cause instanceof Error ? cause.message : String(cause)}`];
  }
  // reported alone: a slot inside a section would also count as never inserted, which is not what needs fixing
  const other = tags.filter(([type]) => type in OTHER_TAGS);
  if (other.length > 0) return other.map(([type, name]) => `prompt may only insert slots, written {{slot}}: {{${type}${name}}} is ${OTHER_TAGS[type]}`);
  const inserted = new Set(tags.map(([, name]) => name));
  return [
    ...[...inserted].filter((n) => !slots.includes(n)).map((n) => `prompt inserts {{${n}}}, which is not one of the slots (${slots.join(", ")})`),
    ...slots.filter((n) => !inserted.has(n)).map((n) => `slot "${n}" is never inserted in the prompt`),
  ];
}

/**
 * A style from untrusted data (a style.json of a pack, a built-in under test), or an error that lists everything wrong with it.
 * The single validator of the shape: whatever passes can be listed, shown and rendered.
 */
export function parseStyle(raw: unknown): Style {
  if (!isRecord(raw)) throw new Error(`Invalid style: it must be an object with the fields ${FIELDS.join(", ")}`);
  const problems: string[] = [];
  const { id, title, kind, aspects, channels, slots, prompt, models, params, version, use, copy, avoid } = raw;
  for (const key of Object.keys(raw)) if (!FIELDS.includes(key)) problems.push(`unknown field ${quoted(key)} (a style has: ${FIELDS.join(", ")})`);
  if (typeof id !== "string" || !STYLE_ID.test(id)) problems.push('id must be lowercase letters, digits and single hyphens, starting with a letter, such as "product-hero"');
  for (const [key, value] of Object.entries({ title, use, copy, avoid })) if (!isText(value)) problems.push(`${key} must be non-empty text on one line`);
  if (!STYLE_KINDS.some((k) => k === kind)) problems.push(`kind must be ${STYLE_KINDS.map((k) => `"${k}"`).join(" or ")}`);
  if (!isList(aspects, ASPECT)) problems.push('aspects must list at least one ratio such as "4:5"; the first is the default');
  if (!isList(channels, NAME)) problems.push('channels must list at least one channel by its calendar name, such as "linkedin"');
  const slotsOk = isTextRecord(slots) && Object.keys(slots).length > 0;
  if (!slotsOk) problems.push('slots must map at least one slot name (lowercase letters, digits and _) to what it should hold, on one line, such as { "subject": "The product as it appears in the frame" }');
  if (!isText(prompt)) problems.push("prompt must be non-empty text on one line");
  else if (prompt.length > MAX_PROMPT) problems.push(`prompt is ${prompt.length} characters: a generation takes at most ${MAX_PROMPT}, and the slot values need room in it`);
  else if (slotsOk) problems.push(...promptProblems(prompt, Object.keys(slots)));
  if (models !== undefined && !(isTextRecord(models) && Object.values(models).every((m) => MODEL_ID.test(m)))) problems.push('models must map a provider id (lowercase letters, digits and _) to a model id (lowercase letters, digits, _ . -), such as { "higgsfield": "nano_banana_pro" }');
  if (params !== undefined && !isTextRecord(params)) problems.push('params must map a parameter name (lowercase letters, digits and _) to a text value on one line, such as { "duration": "8" }');
  if (!Number.isInteger(version) || (version as number) < 1) problems.push("version must be a whole number, 1 or more");
  // named by its id only when that is an id: anything else is somebody's text and is not repeated
  if (problems.length > 0) throw new Error(`Invalid style${typeof id === "string" && STYLE_ID.test(id) ? ` "${id}"` : ""}:\n${problems.map((p) => `- ${p}`).join("\n")}`);
  return { id, title, kind, aspects, channels, slots, prompt, ...(models === undefined ? {} : { models }), ...(params === undefined ? {} : { params }), version, use, copy, avoid } as Style;
}

/**
 * The prompt, model, aspect and parameters of one generation in this style. The caller fills every slot and nothing else; the
 * aspect defaults to the style's first and must be one it lists; the model is the one given, else the style's for the provider;
 * a parameter given replaces the style's of that name.
 */
export function renderStyle(style: Style, input: { slots: Record<string, string>; provider: string; model?: string; aspect?: string; params?: Record<string, string> }): Required<Pick<GenSpec, "model" | "prompt" | "aspect" | "params">> {
  const names = Object.keys(style.slots);
  const show = `bb brandwise style show ${style.id}`;
  const given = new Map(Object.entries(input.slots).map(([name, value]) => [name, value.trim()]));
  const unknown = [...given.keys()].filter((n) => !names.includes(n));
  if (unknown.length > 0) throw new Error(`Style "${style.id}" has no slot ${unknown.map((n) => `"${n}"`).join(", ")}. Its slots are ${names.join(", ")}: use those names (${show}).`);
  const missing = names.filter((n) => !given.get(n));
  if (missing.length > 0) throw new Error(`Style "${style.id}" needs every slot filled. Missing: ${missing.map((n) => `${n} (${style.slots[n]})`).join("; ")}. Add each as --slot <name>="<text>".`);
  const aspect = input.aspect ?? style.aspects[0];
  if (!style.aspects.includes(aspect)) throw new Error(`Style "${style.id}" is not composed for aspect ${aspect}. Use one of ${style.aspects.join(", ")} (the first is the default), or a style that offers ${aspect}: bb brandwise style list.`);
  const model = input.model ?? style.models?.[input.provider];
  if (model === undefined) {
    const named = Object.keys(style.models ?? {});
    throw new Error(`Style "${style.id}" names no model for provider "${input.provider}"${named.length > 0 ? ` (only for ${named.join(", ")})` : ""}. Give one with --model <id>; bb brandwise creative models lists what the provider offers.`);
  }
  // slot values are plain text, not HTML: nothing is escaped
  const prompt = Mustache.render(style.prompt, Object.fromEntries(given), {}, { escape: String });
  return { model, prompt, aspect, params: { ...style.params, ...input.params } };
}

/** The pack a style's address names: `<pack>/<id>` is a style of that pack; a bare id is a built-in style and names none. */
export function packOf(address: string): string | null {
  const slash = address.indexOf("/");
  return slash < 0 ? null : address.slice(0, slash);
}

/** What an asset records about the style it was made in: which recipe, which version of it and where the recipe came from. */
export type StyleRef = { id: string; version: number; origin: "built-in" | `pack:${string}` };

/** What a generation that names a style gives beside the style: the slots, the provider it generates with and what it sets itself. */
export type StyleRequest = { slots: Record<string, string>; provider: string; model?: string; aspect?: string; params?: Record<string, string>; prompt?: string };

/** Of these styles, the ones of a kind and for a channel; without a filter, all of them. */
export function selectStyles(styles: readonly Style[], filter: { kind?: string; channel?: string }): Style[] {
  const { kind, channel } = filter;
  if (kind !== undefined && !STYLE_KINDS.some((k) => k === kind)) throw new Error(`Unknown kind "${kind}": a style is ${STYLE_KINDS.join(" or ")}`);
  return styles.filter((s) => (kind === undefined || s.kind === kind) && (channel === undefined || s.channels.includes(channel)));
}

/**
 * A generation that names a style: the prompt, model, aspect and parameters rendered from it, and what the asset records about it.
 * The style alone writes the prompt, so a prompt given beside it is refused: an edited copy of a template would be recorded, and
 * later measured, as the style.
 */
export function styledSpec(style: Style, origin: StyleRef["origin"], request: StyleRequest) {
  if (request.prompt !== undefined) throw new Error(`--style and --prompt cannot be combined: style "${style.id}" writes the prompt from its slots. Drop --prompt and fill the slots with --slot <name>="<text>" (bb brandwise style show ${style.id}), or drop --style to write the whole prompt yourself.`);
  const ref: StyleRef = { id: style.id, version: style.version, origin };
  return { spec: renderStyle(style, request), style: ref };
}
