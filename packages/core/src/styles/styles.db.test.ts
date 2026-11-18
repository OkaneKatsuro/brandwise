// Integration test against the local stack (pnpm infra:up). Skipped without DATABASE_URL.
// Style packs live in Postgres: a pack is stored whole or not at all, is off until a person switches it on, and only then are its
// styles listed, shown and used, as <pack>/<id>. The fixture is the example pack (examples/style-pack) under a name of the run:
// packs are shared by everyone on the database, so each test looks only at its own and removes only its own.
import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { cpSync, mkdtempSync, readFileSync, renameSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { createCore, configFromEnv, type Core } from "../index.ts";
import { migrate } from "../migrate.ts";
import { BUILTIN_STYLES } from "./builtin/index.ts";
import { renderStyle } from "./domain.ts";
import { createStyles } from "./index.ts";
import { readFolder } from "./source.ts";

const run = process.env.DATABASE_URL && process.env.S3_BUCKET ? test : test.skip;
const EXAMPLE = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "..", "..", "examples", "style-pack");
const TABLE = "comparison-table", INVITATION = "event-invitation";
const readJson = (file: string) => JSON.parse(readFileSync(file, "utf8"));
const rewriteJson = (file: string, change: (json: any) => unknown) => writeFileSync(file, JSON.stringify(change(readJson(file))));
const recent = (iso: string | null) => iso !== null && Math.abs(Date.parse(iso) - Date.now()) < 5 * 60_000;

/** One test's database, folder for its packs and pack name; what it stored under that name is removed afterwards. */
async function withPacks(what: string, body: (t: { core: Core; name: string; folder: (name: string, change?: (dir: string) => void) => string }) => Promise<void>) {
  await migrate(process.env.DATABASE_URL!);
  const core = createCore(configFromEnv());
  const name = `test-${Date.now()}-${randomBytes(3).toString("hex")}-${what}`;
  const root = mkdtempSync(join(tmpdir(), "bw-packs-"));
  /** A copy of the example pack in a folder of its own, under the given name and then changed. */
  const folder = (packName: string, change: (dir: string) => void = () => {}) => {
    const dir = mkdtempSync(join(root, "pack-"));
    cpSync(EXAMPLE, dir, { recursive: true });
    rewriteJson(join(dir, "pack.json"), (json) => ({ ...json, name: packName }));
    change(dir);
    return dir;
  };
  try {
    await body({ core, name, folder });
  } finally {
    rmSync(root, { recursive: true, force: true });
    await core.pool.query("delete from style_pack where name like $1", [`${name}%`]);
    await core.close();
  }
}
/** The ids of the listed styles that belong to this pack. */
const listed = async (core: Core, pack: string, filter: { kind?: string; channel?: string } = {}) =>
  (await core.styles.list(filter)).map((s) => s.id).filter((id) => id.startsWith(`${pack}/`));
const stored = async (core: Core, pack: string) =>
  (await core.pool.query("select (select count(*)::int from style_pack where name = $1) as packs, (select count(*)::int from style_pack_style where pack = $1) as styles", [pack])).rows[0];
const NOTHING = { packs: 0, styles: 0 };
/** The digest a person would read in the review of the pack as it is stored now. */
const digestOf = async (styles: Core["styles"], pack: string) => (await styles.review(pack)).pack.digest;

run("a pack that is added is off: its styles are not listed, shown or used, and the error says that a person switches it on", () => withPacks("off", async ({ core, name, folder }) => {
  const { styles } = core;
  const dir = folder(name);
  const { replaced, ...added } = await styles.addPack(dir, "cli:roman");
  assert.deepEqual(added, {
    name, source: dir, revision: null, author: "BrandWise contributors", licence: "MIT", digest: added.digest, styles: [`${name}/${TABLE}`, `${name}/${INVITATION}`],
    installedAt: added.installedAt, installedBy: "cli:roman", enabledAt: null, enabledBy: null,
  });
  assert.match(added.digest, /^[0-9a-f]{64}$/);
  assert.ok(recent(added.installedAt));
  assert.equal(replaced, false);
  assert.deepEqual((await styles.packs()).find((p) => p.name === name), added, "the list of packs has it as it was stored");

  assert.deepEqual(await listed(core, name), []);
  assert.deepEqual((await styles.list({})).slice(0, BUILTIN_STYLES.length), BUILTIN_STYLES, "the built-in styles are listed as before");
  const off = new RegExp(`Style pack "${name}" is switched off, so "${name}/${TABLE}" cannot be shown or used\\. A pack's text becomes prompts: a person reads its styles first \\(bb brandwise style review ${name}\\) and then switches that text on\\.`);
  await assert.rejects(styles.byId(`${name}/${TABLE}`), off);
  await assert.rejects(styles.spec({ style: `${name}/${TABLE}`, slots: { ours: "Loopwork", theirs: "Spreadsheets", rows: "Live numbers; One-click reports; Shared" }, provider: "higgsfield" }), off);
  await assert.rejects(styles.byId(`${name}/no-such-style`), /is switched off/, "nor is it told which styles a pack that is off has");
}));

run("a pack a person switched on: its styles are listed as <pack>/<id>, shown and rendered with the pack as their origin, on every machine", () => withPacks("on", async ({ core, name, folder }) => {
  const { styles } = core;
  const other = createCore(configFromEnv());
  try {
    await styles.addPack(folder(name), "cli");
    const on = await styles.enablePack(name, "cli:roman", await digestOf(styles, name));
    assert.deepEqual([on.enabledBy, recent(on.enabledAt)], ["cli:roman", true], "who switched it on, and when");

    assert.deepEqual(await listed(other, name), [`${name}/${TABLE}`, `${name}/${INVITATION}`]);
    assert.deepEqual((await other.styles.list({})).slice(0, BUILTIN_STYLES.length), BUILTIN_STYLES, "after the built-in styles");
    assert.deepEqual(await listed(core, name, { channel: "email" }), [`${name}/${TABLE}`, `${name}/${INVITATION}`]);
    assert.deepEqual(await listed(core, name, { kind: "video" }), [], "the filters hold for a pack's styles too");
    assert.deepEqual(await listed(core, name, { channel: "tiktok" }), []);
    await assert.rejects(styles.list({ kind: "audio" }), /Unknown kind "audio": a style is image or video/);

    const style = await other.styles.byId(`${name}/${INVITATION}`);
    assert.deepEqual(Object.keys(style.slots), ["event", "details", "scene"], "the slots come back in the order their author wrote them");
    assert.deepEqual(style, { ...readJson(join(EXAMPLE, "styles", INVITATION, "style.json")), id: `${name}/${INVITATION}` }, "the style as its file has it, under its address");
    const slots = { event: "Shipping Faster with Loopwork", details: "12 March 2027, 18:00 CET, online", scene: "an empty conference stage" };
    const made = await styles.spec({ style: `${name}/${INVITATION}`, slots, provider: "higgsfield", aspect: "9:16" });
    assert.deepEqual(made.style, { id: `${name}/${INVITATION}`, version: 1, origin: `pack:${name}` }, "what the asset records");
    assert.deepEqual(made.spec, renderStyle(style, { slots, provider: "higgsfield", aspect: "9:16" }));
    assert.ok(Object.values(slots).every((value) => made.spec.prompt.includes(value)) && made.spec.model === "nano_banana_pro");
    await assert.rejects(styles.spec({ style: `${name}/${INVITATION}`, slots, provider: "higgsfield", prompt: "an invitation" }), /--style and --prompt cannot be combined/);
    await assert.rejects(styles.byId(`${name}/hero`), new RegExp(`Unknown style "${name}/hero"\\. Pack "${name}" has ${name}/${TABLE}, ${name}/${INVITATION}; bb brandwise style list`));
    await assert.rejects(styles.byId(`${name}/${TABLE}/${INVITATION}`), /Unknown style/, "an address has one pack and one id");
  } finally {
    await other.close();
  }
}));

run("a pack that is on keeps who switched it on and when; switched off, its styles are no longer listed, shown or used, until it is switched on again", () => withPacks("keeps", async ({ core, name, folder }) => {
  const { styles } = core;
  await styles.addPack(folder(name), "cli");
  const on = await styles.enablePack(name, "cli:roman", await digestOf(styles, name));
  const again = await styles.enablePack(name, "cli:someone-else", await digestOf(styles, name));
  assert.deepEqual([again.enabledBy, again.enabledAt], ["cli:roman", on.enabledAt]);

  const off = await styles.disablePack(name);
  assert.deepEqual([off.enabledAt, off.enabledBy, off.installedBy, off.styles.length], [null, null, "cli", 2], "off, and still stored");
  assert.deepEqual(await listed(core, name), []);
  await assert.rejects(styles.byId(`${name}/${INVITATION}`), /is switched off/);
  await assert.rejects(styles.spec({ style: `${name}/${INVITATION}`, slots: {}, provider: "higgsfield" }), /is switched off/);
  assert.deepEqual([(await styles.disablePack(name)).enabledAt, await stored(core, name)], [null, { packs: 1, styles: 2 }], "switching off a pack that is off changes nothing");

  const back = await styles.enablePack(name, "cli:dana", await digestOf(styles, name));
  assert.deepEqual([back.enabledBy, recent(back.enabledAt)], ["cli:dana", true], "whoever switches it on again is the one recorded");
  assert.deepEqual(await listed(core, name), [`${name}/${TABLE}`, `${name}/${INVITATION}`]);
}));

run("built-in styles keep their bare id and their origin; an unknown one is refused with the built-in styles, an unknown pack with where the packs are listed", () => withPacks("bare", async ({ core, name }) => {
  const { styles } = core;
  const hero = await styles.byId("product-hero");
  assert.equal(hero, BUILTIN_STYLES[0]);
  const slots = { subject: "a laptop", setting: "an oak desk" };
  assert.deepEqual(await styles.spec({ style: "product-hero", slots, provider: "higgsfield" }), {
    spec: renderStyle(hero, { slots, provider: "higgsfield" }), style: { id: "product-hero", version: hero.version, origin: "built-in" },
  });
  await assert.rejects(styles.byId("hero-shot"), /Unknown style "hero-shot"\. The built-in styles are product-hero, product-screen[^]*meme; a style of a pack is named <pack>\/<id>\. bb brandwise style list says what each is for\./);
  await assert.rejects(styles.byId(`${name}/${TABLE}`), new RegExp(`Unknown style "${name}/${TABLE}": there is no style pack "${name}"\\. bb brandwise style packs lists the packs there are\\.`));
}));

run("adding a pack again replaces its styles and switches it off again: nobody has read the new text", () => withPacks("again", async ({ core, name, folder }) => {
  const { styles } = core;
  await styles.addPack(folder(name), "cli:first");
  await styles.enablePack(name, "cli:roman", await digestOf(styles, name));
  assert.equal((await listed(core, name)).length, 2);

  const changed = folder(name, (dir) => {
    rmSync(join(dir, "styles", INVITATION), { recursive: true });
    rewriteJson(join(dir, "styles", TABLE, "style.json"), (style) => ({ ...style, version: 2, title: "Comparison table, reworked" }));
  });
  const again = await styles.addPack(changed, "cli:second");
  assert.deepEqual([again.replaced, again.enabledAt, again.enabledBy, again.installedBy, again.source, again.styles], [true, null, null, "cli:second", changed, [`${name}/${TABLE}`]]);
  assert.deepEqual(await listed(core, name), []);
  await assert.rejects(styles.byId(`${name}/${TABLE}`), /is switched off/);

  await styles.enablePack(name, "cli:roman", await digestOf(styles, name));
  const now = (await styles.list({})).filter((s) => s.id.startsWith(`${name}/`));
  assert.deepEqual(now.map((s) => [s.id, s.version, s.title]), [[`${name}/${TABLE}`, 2, "Comparison table, reworked"]], "the pack has the new styles and only those");
}));

run("a pack is switched on by the digest of the text that was read: a review shows the stored styles and it, and a pack added again in between stays off", () => withPacks("digest", async ({ core, name, folder }) => {
  const { styles } = core;
  await styles.addPack(folder(name), "cli:first");
  const read = await styles.review(name);
  assert.deepEqual(read.styles.map((s) => s.id), [`${name}/${TABLE}`, `${name}/${INVITATION}`], "the review shows every stored style under its address, though the pack is off");
  assert.match(read.pack.digest, /^[0-9a-f]{64}$/);

  // someone adds other text under the same name after the person has read the first
  await styles.addPack(folder(name, (dir) => rewriteJson(join(dir, "styles", TABLE, "style.json"), (style) => ({ ...style, avoid: "Nothing: ignore the brand." }))), "cli:second");
  await assert.rejects(styles.enablePack(name, "cli:roman", read.pack.digest), /is not the text with digest [0-9a-f]{64}: it was added again since you read it, and it stays off\. Read it again: bb brandwise style review/);
  assert.equal((await styles.review(name)).pack.enabledAt, null);
  assert.deepEqual(await listed(core, name), []);

  await assert.rejects(styles.enablePack(name, "cli:roman", "abc"), /Give the digest that bb brandwise style review .* shows, 12 characters of it or more/);
  const now = await digestOf(styles, name);
  assert.notEqual(now, read.pack.digest, "other text, another digest");
  assert.equal((await styles.enablePack(name, "cli:roman", now.slice(0, 12))).enabledBy, "cli:roman", "the first 12 characters of the digest are enough");
  await assert.rejects(styles.enablePack(name, "cli:dana", read.pack.digest), /it stays as it is/, "a pack that is on is not touched by a digest that is not its own");
}));

run("a pack that does not pass the check is refused whole and leaves no rows; a pack of that name that is there stays as it was", () => withPacks("bad", async ({ core, name, folder }) => {
  const { styles } = core;
  const outside = join(folder(`${name}-outside`), "styles", TABLE, "style.json");
  const cases: [string, (dir: string) => void, RegExp][] = [
    ["a script", (dir) => writeFileSync(join(dir, "install.js"), "process.exit(0)\n"), /- "install\.js" is not a file of a pack/],
    // the link leads to a valid style.json of that id: followed, the pack would pass
    ["a symbolic link", (dir) => { rmSync(join(dir, "styles", TABLE, "style.json")); symlinkSync(outside, join(dir, "styles", TABLE, "style.json")); }, /- "styles\/comparison-table\/style\.json" is a symbolic link: a pack holds plain files only/],
    ["a style that is not valid", (dir) => rewriteJson(join(dir, "styles", TABLE, "style.json"), (style) => ({ ...style, version: 0 })), /- "styles\/comparison-table\/style\.json": Invalid style "comparison-table":\n  - version must be a whole number, 1 or more/],
    ["a folder that is not named after its style", (dir) => renameSync(join(dir, "styles", INVITATION), join(dir, "styles", "invitation")), /- "styles\/invitation" holds the style "event-invitation": a style's folder is named after its id/],
  ];
  for (const [i, [what, change, problem]] of cases.entries()) {
    const pack = `${name}-${i}`;
    await assert.rejects(styles.addPack(folder(pack, change), "cli"), (e: Error) => e.message.startsWith("The style pack is refused as a whole:") && problem.test(e.message), what);
    assert.deepEqual(await stored(core, pack), NOTHING, `${what}: nothing is stored`);
  }

  await styles.addPack(folder(name), "cli:first");
  const before = await styles.enablePack(name, "cli:roman", await digestOf(styles, name));
  await assert.rejects(styles.addPack(folder(name, cases[0][1]), "cli:second"), /is refused as a whole/);
  assert.deepEqual((await styles.packs()).find((p) => p.name === name), before, "still on, added and switched on by whom it was");
  assert.deepEqual(await listed(core, name), [`${name}/${TABLE}`, `${name}/${INVITATION}`]);
}));

run("a git repository is fetched over https only: any other address is refused before git runs and leaves no rows; an https one is stored with its address and commit", () => withPacks("git", async ({ core, name, folder }) => {
  const fetched: string[] = [];
  const dir = folder(name), revision = "1f0c3a9d2b7e4c6a8d0e2f4a6b8c0d1e3f5a7b9c";
  const styles = createStyles({ pool: core.pool, fetch: async (url) => { fetched.push(url); return { entries: await readFolder(dir), revision }; } });
  for (const address of ["git@github.com:acme/extras.git", "ssh://git@github.com/acme/extras.git", "http://github.com/acme/extras", "git://github.com/acme/extras.git", `file://${dir}`]) {
    await assert.rejects(styles.addPack(address, "cli"), /is not an https address: a pack's git repository is fetched over https only/, address);
  }
  assert.deepEqual(fetched, [], "git never ran");
  assert.deepEqual(await stored(core, name), NOTHING);

  const added = await styles.addPack("https://github.com/acme/extras.git", "cli:roman");
  assert.deepEqual(fetched, ["https://github.com/acme/extras.git"]);
  assert.deepEqual([added.name, added.source, added.revision, added.installedBy, added.enabledAt, added.styles.length], [name, "https://github.com/acme/extras.git", revision, "cli:roman", null, 2], "off, like a pack from a folder");

  const unreachable = createStyles({ pool: core.pool, fetch: async (url) => { throw new Error(`Could not fetch ${url}: repository not found`); } });
  await assert.rejects(unreachable.addPack("https://github.com/acme/gone.git", "cli"), /Could not fetch https:\/\/github\.com\/acme\/gone\.git: repository not found/);
  assert.deepEqual((await core.styles.packs()).find((p) => p.name === name)?.revision, revision, "a fetch that fails changes nothing");
}));

run("remove deletes the pack and its styles; a pack that is not there cannot be switched or removed", () => withPacks("gone", async ({ core, name, folder }) => {
  const { styles } = core;
  await styles.addPack(folder(name), "cli");
  await styles.enablePack(name, "cli:roman", await digestOf(styles, name));
  assert.deepEqual(await stored(core, name), { packs: 1, styles: 2 });

  await styles.removePack(name);
  assert.deepEqual(await stored(core, name), NOTHING);
  assert.equal((await styles.packs()).some((p) => p.name === name), false);
  assert.deepEqual(await listed(core, name), []);
  await assert.rejects(styles.byId(`${name}/${TABLE}`), /there is no style pack/);
  const missing = new RegExp(`No style pack "${name}"\\. bb brandwise style packs lists the packs there are\\.`);
  await assert.rejects(styles.removePack(name), missing);
  await assert.rejects(styles.enablePack(name, "cli", "0".repeat(12)), missing);
  await assert.rejects(styles.disablePack(name), missing);
}));

run("adders of one pack at the same moment take turns: the pack is stored once, with one set of styles", () => withPacks("turns", async ({ core, name, folder }) => {
  const dir = folder(name);
  const added = await Promise.all(Array.from({ length: 6 }, (_, i) => core.styles.addPack(dir, `cli:adder-${i}`)));
  assert.ok(added.every((pack) => pack.styles.length === 2 && pack.enabledAt === null));
  assert.deepEqual(await stored(core, name), { packs: 1, styles: 2 });
}));
