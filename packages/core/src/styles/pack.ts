// Style packs (docs/context-styles-map.md, step 6): styles that come from outside the repository. A pack is somebody else's text
// that becomes prompts, so its shape is strict and it is taken whole or not at all. Pure: no disk, no database, no network. Where
// a pack may come from, what its folder may hold, and the check that turns the folder's content into styles.
import { isAbsolute, resolve } from "node:path";
import { isRecord, isText, parseStyle, plain, quoted, STYLE_ID, type Style } from "./domain.ts";

/** A style.json is a few kilobytes and a licence text a few dozen: a larger file is not what a pack is made of. */
export const MAX_FILE_BYTES = 100_000;
const MAX_STYLES = 100;
const MAX_NAME = 40;
const MAX_LINE = 100;

const MANIFEST = ["name", "author", "licence"];
const TOP_FILES = ["pack.json", "README.md", "LICENSE"];
const STYLE_FOLDER = /^styles\/[^/]+$/;
const STYLE_FILE = /^styles\/[^/]+\/style\.json$/;
/** Another address than https: one with a scheme, or git's own `user@host:path`. */
const OTHER_ADDRESS = /^[a-z][a-z0-9+.-]*:\/\/|^[^/\s]+@[^/\s]+:/i;

/** Where a pack is read from: a folder on this machine by its full path, or a git repository by its https address. */
type PackSource = { kind: "folder" | "git"; location: string };

/** One thing found in a pack's folder. `path` is from the top of the pack, with "/" between its parts. */
export type PackEntry = {
  path: string;
  kind: "file" | "folder" | "link" | "other";
  /** The size of a file; 0 for anything else. */
  bytes: number;
  /** The text of a .json file that is within MAX_FILE_BYTES: the files the check parses. */
  text?: string;
};

/** A pack that passed the check: what its pack.json says and its styles, in the order of their ids. */
type StylePack = { name: string; author: string; licence: string; styles: Style[] };

/**
 * Where `given` says a pack is. A git repository is fetched over https and nothing else, so every other kind of address is
 * refused here, before git runs; so is an address that signs in, because the address is stored and shown. A folder is named by
 * its full path: what is stored as the source then means one place.
 */
export function packSource(given: string): PackSource {
  if (/^https:\/\//i.test(given)) {
    let url: URL;
    try {
      url = new URL(given);
    } catch {
      throw new Error(`${given} is not a valid address: give the https address of the pack's git repository, such as https://github.com/<owner>/<repository>`);
    }
    if (url.username !== "" || url.password !== "") throw new Error("The address carries a user name or a password: a pack is fetched without signing in, and its address is stored and shown. Give the address without them.");
    return { kind: "git", location: url.href };
  }
  if (OTHER_ADDRESS.test(given)) throw new Error(`${given} is not an https address: a pack's git repository is fetched over https only. Give its https:// address, or the full path of a folder that holds the pack.`);
  if (!isAbsolute(given)) throw new Error(`${given} is not a full path: give the pack's folder by its full path (the command cannot see your working directory), or the https address of its git repository.`);
  return { kind: "folder", location: resolve(given) };
}

const oneLine = (v: unknown): v is string => isText(v) && v.length <= MAX_LINE;

/** What is wrong with the content of pack.json. */
function manifestProblems(raw: unknown): string[] {
  if (!isRecord(raw)) return [`"pack.json" must be an object with the fields ${MANIFEST.join(", ")}`];
  const { name, author, licence } = raw;
  return [
    ...Object.keys(raw).filter((key) => !MANIFEST.includes(key)).map((key) => `"pack.json" has an unknown field ${quoted(key)} (it has: ${MANIFEST.join(", ")})`),
    ...(typeof name === "string" && name.length <= MAX_NAME && STYLE_ID.test(name) ? [] : [`"pack.json": name must be lowercase letters, digits and single hyphens, starting with a letter, ${MAX_NAME} characters at most, such as "founder-extras"`]),
    ...(oneLine(author) ? [] : [`"pack.json": author must be one line of text, ${MAX_LINE} characters at most, such as "Dana Whitfield <dana@example.com>"`]),
    ...(oneLine(licence) ? [] : [`"pack.json": licence must be one line of text, ${MAX_LINE} characters at most, such as "MIT" or "CC-BY-4.0"`]),
  ];
}

/**
 * The pack that a folder holds, or an error that lists everything wrong with it. `entries` is everything in the folder, folders
 * included. A pack holds pack.json, a README.md and a LICENSE if it has them, and styles/<id>/style.json per style, as plain
 * files of a bounded size: any other file or folder, a link, a file that does not parse or validate, or a style folder that is
 * not named after its style refuses the whole pack. Two folders can therefore never hold one id.
 */
export function checkPack(entries: readonly PackEntry[]): StylePack {
  const problems: string[] = [];
  const paths = new Set(entries.map((e) => e.path));
  const files = new Map<string, PackEntry>();
  const styleFolders: string[] = [];
  const strangeFolders: string[] = [];
  for (const e of [...entries].sort((a, b) => (a.path < b.path ? -1 : 1))) {
    // a folder a pack does not have is named once; what it holds is not listed
    if (strangeFolders.some((folder) => e.path.startsWith(`${folder}/`))) continue;
    if (e.kind === "link") problems.push(`${quoted(e.path)} is a symbolic link: a pack holds plain files only`);
    else if (e.kind === "other") problems.push(`${quoted(e.path)} is neither a file nor a folder`);
    else if (e.kind === "folder") {
      if (STYLE_FOLDER.test(e.path)) styleFolders.push(e.path);
      else if (e.path !== "styles") {
        strangeFolders.push(e.path);
        problems.push(`${quoted(e.path)} is a folder a pack does not have`);
      }
    } else if (!TOP_FILES.includes(e.path) && !STYLE_FILE.test(e.path)) problems.push(`${quoted(e.path)} is not a file of a pack`);
    else if (e.bytes > MAX_FILE_BYTES) problems.push(`${quoted(e.path)} is ${e.bytes} bytes: a file of a pack is ${MAX_FILE_BYTES} bytes at most`);
    else files.set(e.path, e);
  }
  /** The JSON of a file accepted so far; undefined, and a problem, when it does not parse. */
  const json = (path: string): unknown => {
    try {
      return JSON.parse(files.get(path)?.text ?? "");
    } catch (cause) {
      // the parser's message repeats a piece of the file
      problems.push(`${quoted(path)} is not valid JSON: ${plain(cause instanceof Error ? cause.message : String(cause))}`);
      return undefined;
    }
  };

  // a pack.json that is there but was refused above (a link, a folder, too large) is not also reported as missing
  const manifest = files.has("pack.json") ? json("pack.json") : undefined;
  if (!paths.has("pack.json")) problems.push('"pack.json" is missing: it names the pack, its author and its licence');
  else if (manifest !== undefined) problems.push(...manifestProblems(manifest));

  if (styleFolders.length === 0) problems.push('The pack has no style: each one is a folder "styles/<id>" with a style.json');
  if (styleFolders.length > MAX_STYLES) problems.push(`The pack has ${styleFolders.length} styles: a pack holds ${MAX_STYLES} at most`);
  for (const folder of styleFolders) if (!paths.has(`${folder}/style.json`)) problems.push(`${quoted(folder)} has no style.json`);
  const styles: Style[] = [];
  for (const path of [...files.keys()].filter((p) => STYLE_FILE.test(p))) {
    const raw = json(path);
    if (raw === undefined) continue;
    const folder = path.slice(0, path.lastIndexOf("/"));
    try {
      const style = parseStyle(raw);
      if (folder === `styles/${style.id}`) styles.push(style);
      else problems.push(`${quoted(folder)} holds the style "${style.id}": a style's folder is named after its id`);
    } catch (cause) {
      problems.push(`${quoted(path)}: ${(cause instanceof Error ? cause.message : String(cause)).replaceAll("\n", "\n  ")}`);
    }
  }

  if (problems.length > 0) {
    throw new Error(`The style pack is refused as a whole:\n${problems.map((p) => `- ${p}`).join("\n")}\nA pack holds pack.json, a README.md and a LICENSE if it has them, and one styles/<id>/style.json per style; nothing else.`);
  }
  const { name, author, licence } = manifest as Omit<StylePack, "styles">;
  return { name, author, licence, styles: styles.sort((a, b) => (a.id < b.id ? -1 : 1)) };
}
