// The company's look as code applies it (docs/context-styles-map.md, step 3): the pack's design.json, and the words it puts in
// front of every prompt. Pure. design.md says the same for people and agents; this file is the one code reads, so its shape is
// checked when it is written, and whatever passes can be applied without a second look.
import { MAX_PROMPT } from "../providers/index.ts";
import { isRecord, isText, quoted } from "../styles/domain.ts";

/** What a colour of the look is used for. The order is the order of the palette in a prompt. */
const COLOR_ROLES = ["background", "text", "heading", "link", "primary", "onPrimary"] as const;
type ColorRole = (typeof COLOR_ROLES)[number];
/** A look without these is not one: a surface, what is read on it, and the colour the company is known by. */
const REQUIRED_ROLES: readonly ColorRole[] = ["background", "text", "primary"];
/** How a role is called in a prompt, where it is read by a model that makes pictures. */
const ROLE_WORDS: Record<ColorRole, string> = { background: "background", text: "text", heading: "headings", link: "links", primary: "primary", onPrimary: "text on primary" };
const FONT_ROLES = ["heading", "body"] as const;
const FIELDS = ["colors", "fonts", "imagePromptPrefix"];
const HEX = /^#[0-9a-f]{6}$/i;
/** A font family is a name, not a sentence. */
export const MAX_FONT = 80;
/** The image style stands in front of every prompt of the company, so it is a sentence or two, not a brief. */
const MAX_PREFIX = 400;

export type Design = {
  /** Role -> hex colour. */
  colors: Partial<Record<ColorRole, string>>;
  /** The font family of headings and of text. */
  fonts?: Partial<Record<(typeof FONT_ROLES)[number], string>>;
  /** The company's image style in words. */
  imagePromptPrefix?: string;
};

/** What an asset records about the look it was generated in: the version of design.json that was applied. */
export type LookRef = { version: number };

/** What `body` holds as a design.json: the look, or everything that is wrong with it. */
function readDesign(body: string): { design: Design } | { problems: string[] } {
  let raw: unknown;
  try { raw = JSON.parse(body); } catch (cause) { return { problems: [`it is not JSON (${cause instanceof Error ? cause.message : String(cause)})`] }; }
  if (!isRecord(raw)) return { problems: [`it must be an object with the fields ${FIELDS.join(", ")}`] };
  const problems = Object.keys(raw).filter((key) => !FIELDS.includes(key)).map((key) => `unknown field ${quoted(key)} (a design.json has: ${FIELDS.join(", ")})`);
  const { colors, fonts, imagePromptPrefix } = raw;
  if (!isRecord(colors)) problems.push(`colors must map a role (${COLOR_ROLES.join(", ")}) to a hex colour, such as { "primary": "#1f6feb" }`);
  else {
    for (const [role, value] of Object.entries(colors)) {
      if (!COLOR_ROLES.some((r) => r === role)) problems.push(`colors has no role ${quoted(role)}: the roles are ${COLOR_ROLES.join(", ")}`);
      else if (typeof value !== "string" || !HEX.test(value)) problems.push(`colors.${role} must be a hex colour with six digits, such as "#1f6feb"`);
    }
    const missing = REQUIRED_ROLES.filter((role) => !(role in colors));
    if (missing.length > 0) problems.push(`colors must have at least ${REQUIRED_ROLES.join(", ")}: ${missing.join(", ")} ${missing.length === 1 ? "is" : "are"} missing`);
  }
  if (fonts !== undefined) {
    if (!isRecord(fonts) || Object.keys(fonts).length === 0) problems.push(`fonts must map ${FONT_ROLES.join(" or ")} to a font family, such as { "heading": "Sora" }`);
    else for (const [role, value] of Object.entries(fonts)) {
      if (!FONT_ROLES.some((r) => r === role)) problems.push(`fonts has no ${quoted(role)}: it names the font of ${FONT_ROLES.join(" and of ")}`);
      else if (!isText(value) || value.length > MAX_FONT) problems.push(`fonts.${role} must be the name of a font family, on one line and at most ${MAX_FONT} characters`);
    }
  }
  if (imagePromptPrefix !== undefined) {
    if (!isText(imagePromptPrefix)) problems.push("imagePromptPrefix must be text on one line: the company's image style in words");
    else if (imagePromptPrefix.length > MAX_PREFIX) problems.push(`imagePromptPrefix is ${imagePromptPrefix.length} characters: it stands in front of every prompt, so it takes at most ${MAX_PREFIX}`);
  }
  return problems.length === 0 ? { design: raw as Design } : { problems };
}

const refusal = (problems: string[]) => `design.json is not a look that code can apply:\n${problems.map((p) => `- ${p}`).join("\n")}`;

/** Why `body` cannot be the pack's design.json, naming everything that is wrong with it; null when it can. */
export function designProblem(body: string): string | null {
  const read = readDesign(body);
  return "problems" in read ? refusal(read.problems) : null;
}

/** The look a design.json holds. A version of the pack was checked when it was written; one that no longer passes is refused here. */
export function parseDesign(body: string): Design {
  const read = readDesign(body);
  if ("problems" in read) throw new Error(refusal(read.problems));
  return read.design;
}

/**
 * The look in words, as it stands in front of a prompt: the image style, then the palette as one sentence, each colour under
 * the name of its role. Built by code, so every generation of the company says it the same way.
 */
function lookWords(design: Design): string {
  const style = design.imagePromptPrefix?.trim();
  const colors = COLOR_ROLES.flatMap((role) => {
    const value = design.colors[role];
    return value === undefined ? [] : [`${ROLE_WORDS[role]} ${value.toLowerCase()}`];
  });
  const palette = `Brand palette: ${colors.join(", ")}.`;
  return style === undefined ? palette : `${/[.!?]$/.test(style) ? style : `${style}.`} ${palette}`;
}

/**
 * The prompt a generation is asked with: the company's look in front of what a style or the caller wrote; without a look, that
 * alone. The whole has to fit what a generation takes, and the error says what to shorten: `written` names what the caller
 * wrote ("the slot values" of a style, or "the prompt").
 */
export function promptInLook(prompt: string, design: Design | null, written: string): string {
  const look = design === null ? "" : `${lookWords(design)} `;
  const whole = look + prompt;
  if (whole.length <= MAX_PROMPT) return whole;
  const over = whole.length - MAX_PROMPT, by = `by ${over} ${over === 1 ? "character" : "characters"}`;
  throw new Error(design === null
    ? `The prompt is ${whole.length} characters, the limit is ${MAX_PROMPT}: shorten ${written} ${by}`
    : `The prompt is ${whole.length} characters with the company's look in front of it (${look.length} of them), the limit is ${MAX_PROMPT}: shorten ${written} ${by}, or leave the look out with --no-brand`);
}
