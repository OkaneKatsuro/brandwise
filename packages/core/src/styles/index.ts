// The style library: the styles a creative can be generated in, and the generation that names one. A style is never copied per
// company; the caller picks one, fills its slots and code writes the prompt.
import { BUILTIN_STYLES } from "./builtin/index.ts";
import { renderStyle, STYLE_KINDS, type Style } from "./domain.ts";

export type { Style } from "./domain.ts";

/** What an asset records about the style it was made in: which recipe, which version of it and where the recipe came from. */
export type StyleRef = { id: string; version: number; origin: "built-in" };

/** The styles of a kind and for a channel; without a filter, all of them. */
export function listStyles(filter: { kind?: string; channel?: string }): Style[] {
  const { kind, channel } = filter;
  if (kind !== undefined && !STYLE_KINDS.some((k) => k === kind)) throw new Error(`Unknown kind "${kind}": a style is ${STYLE_KINDS.join(" or ")}`);
  return BUILTIN_STYLES.filter((s) => (kind === undefined || s.kind === kind) && (channel === undefined || s.channels.includes(channel)));
}

/** The style with this id, or an error that names the styles there are. */
export function styleById(id: string): Style {
  const style = BUILTIN_STYLES.find((s) => s.id === id);
  if (!style) throw new Error(`Unknown style "${id}". The styles are ${BUILTIN_STYLES.map((s) => s.id).join(", ")}; bb brandwise style list says what each is for.`);
  return style;
}

/**
 * A generation that names a style: the prompt, model, aspect and parameters rendered from it, and what the asset records about it.
 * The style alone writes the prompt, so a prompt given beside it is refused: an edited copy of a template would be recorded, and
 * later measured, as the style.
 */
export function styledSpec(request: { style: string; slots: Record<string, string>; provider: string; model?: string; aspect?: string; params?: Record<string, string>; prompt?: string }) {
  const style = styleById(request.style);
  if (request.prompt !== undefined) throw new Error(`--style and --prompt cannot be combined: style "${style.id}" writes the prompt from its slots. Drop --prompt and fill the slots with --slot <name>="<text>" (bb brandwise style show ${style.id}), or drop --style to write the whole prompt yourself.`);
  const ref: StyleRef = { id: style.id, version: style.version, origin: "built-in" };
  return { spec: renderStyle(style, request), style: ref };
}
