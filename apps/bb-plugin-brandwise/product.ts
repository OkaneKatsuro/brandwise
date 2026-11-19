// CLI of the product pack: `bb brandwise product ...`. The pack itself (versions, confirmation, the sites it was drawn from and
// the page its look was taken from, the import of packs kept on disk) lives in packages/core/src/context; this file parses
// arguments and prints. Agents read the pack with `product get`, the onboarding wizard (skills/product-onboarding) writes it
// with `product set`, a person confirms it with `product confirm`.
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import type { DocVersion, LookSource, SiteSource, SocialSource } from "./core/context/index.ts";
import type { Core } from "./core/index.ts";

type Io = { val: (argv: string[], name: string) => string | undefined; positional: (argv: string[]) => string[]; reply: (value: unknown, text: string) => { exitCode: number; stdout: string }; usage: string; actor: (argv: string[]) => string };

/** Where packs were kept before the database held them: what `product import` reads unless --dir names another folder. */
const PACKS_ON_DISK = path.join(os.homedir(), ".bb-brandwise", "product");

/** One version on a line: its number, when and by whom it was written, and whether a person confirmed it. */
const fmt = (v: DocVersion) =>
  `v${String(v.version).padEnd(3)} ${v.createdAt.slice(0, 16)}  ${v.author.padEnd(16)} ${v.confirmedAt ? `confirmed ${v.confirmedAt.slice(0, 16)} by ${v.confirmedBy}` : "draft"}`;

/**
 * One source of the pack on a line. A site: its latest read, and what the reader noted about its pages. A page the look was
 * taken from: its latest render, the asset that holds the picture, and what was noted. That page's address is where the
 * browser ended, which the page decides, so it stands in quotes; the notes are words of ours. A profile whose posts were read:
 * its latest read, how many posts, and the asset that holds them.
 */
const fmtSource = (s: SiteSource | LookSource | SocialSource) => (s.kind === "site"
  ? `source: ${s.site}  read ${s.readAt.slice(0, 16)}  ${s.pages} ${s.pages === 1 ? "page" : "pages"}${s.notes.length ? `  (on some: ${s.notes.join("; ")})` : ""}`
  : s.kind === "social"
  ? `source: ${s.profile}  posts read ${s.readAt.slice(0, 16)}  ${s.note ?? ""}  ${s.assetId === null ? "posts deleted" : `posts: asset ${s.assetId}`}`
  : `source: ${JSON.stringify(s.page)}  look taken ${s.readAt.slice(0, 16)}  ${s.assetId === null ? "picture deleted" : `picture: asset ${s.assetId}`}${s.note === null ? "" : `  (${s.note})`}`);

/** `bb brandwise product list | get [<file>] | set <file> (--body <text> | --file <path>) | history <file> | confirm [<file>] | import [--dir <folder>]` */
export async function productCli(c: Core, action: string | undefined, args: string[], { val, positional, reply, usage, actor }: Io) {
  const campaign = async () => (await c.campaigns.resolve(val(args, "--campaign"))).id;
  const [name] = positional(args.slice(2));
  if (action === "import") {
    const dir = val(args, "--dir") ?? PACKS_ON_DISK;
    const done = await c.context.importDir(dir, actor(args));
    const lines = done.packs.map((p) =>
      `${p.campaignName}: added ${p.added.join(", ") || "nothing"}${p.kept.length ? `; already in the database: ${p.kept.join(", ")}` : ""}${p.skipped.map((s) => `\n  skipped: ${s.reason}`).join("")}`);
    if (done.unknown.length) lines.push(`Not imported, no campaign has this id: ${done.unknown.join(", ")}`);
    return reply({ dir, ...done }, lines.join("\n") || `No packs in ${dir}.`);
  }
  if (action === "list" || (action === "get" && !name)) {
    const id = await campaign();
    const pack = { ...(await c.context.list(id)), sources: await c.context.sources(id) };
    return reply(pack, [
      pack.files.map((f) => `${f.name.padEnd(24)} ${fmt(f)}`).join("\n") || "files: none",
      `missing: ${pack.missing.join(", ") || "none"}`,
      pack.sources.map(fmtSource).join("\n") || "sources: none",
    ].join("\n"));
  }
  if (action === "confirm") {
    const done = await c.context.confirm(await campaign(), actor(args), name);
    return reply(done, done.length ? `Confirmed ${done.map((v) => `${v.name} v${v.version}`).join(", ")}` : `Nothing to confirm: ${name ?? "the pack"} has no draft`);
  }
  if (!name) return { exitCode: 1, stderr: usage };
  if (action === "get") {
    const doc = await c.context.get(await campaign(), name);
    if (!doc) return { exitCode: 1, stderr: `${name} does not exist yet` };
    const { body, ...version } = doc;
    return reply({ ...version, content: body }, body);
  }
  if (action === "history") {
    const versions = await c.context.history(await campaign(), name);
    if (versions.length === 0) return { exitCode: 1, stderr: `${name} does not exist yet` };
    return reply(versions, versions.map(fmt).join("\n"));
  }
  if (action === "set") {
    const from = val(args, "--file");
    const body = from ? fs.readFileSync(from, "utf8") : val(args, "--body");
    if (body === undefined) return { exitCode: 1, stderr: `Give the content with --body '<text>' or --file <path>\n${usage}` };
    const { doc, added } = await c.context.set(await campaign(), name, body, actor(args));
    return reply({ name, bytes: Buffer.byteLength(body), version: doc.version, added },
      added ? `Saved ${name} as version ${doc.version}, a draft until a person confirms it` : `${name} is unchanged: version ${doc.version} already has this text`);
  }
  return { exitCode: 1, stderr: usage };
}
