// Integration test against the local stack (pnpm infra:up). Skipped without DATABASE_URL.
// The pack lives in Postgres: versions with their author, confirmation by a person, and the import of packs that were kept on disk.
import assert from "node:assert/strict";
import { randomBytes, randomUUID } from "node:crypto";
import { mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { setTimeout as sleep } from "node:timers/promises";
import { createCore, configFromEnv } from "../index.ts";
import { migrate } from "../migrate.ts";
import { purge } from "../testing.ts";

const run = process.env.DATABASE_URL && process.env.S3_BUCKET ? test : test.skip;
const newTag = (what: string) => `test-${Date.now()}-${randomBytes(3).toString("hex")}-${what}`;
const FIVE = ["product.md", "audience.md", "claims.md", "constraints.md", "voice.md"];

run("versions: every change is a new version with its author and time, an equal text adds nothing, another core reads the same pack", async () => {
  await migrate(process.env.DATABASE_URL!);
  const core = createCore(configFromEnv()), other = createCore(configFromEnv());
  const tag = newTag("pack");
  try {
    const { context } = core;
    const base = await core.campaigns.add({ name: `${tag}-base`, kind: "always_on" });
    assert.deepEqual(await context.list(base.id), { files: [], missing: FIVE }, "a new company has no pack");
    assert.equal(await context.get(base.id, "voice.md"), null);
    assert.deepEqual(await context.history(base.id, "voice.md"), []);

    const first = await context.set(base.id, "voice.md", "Plain and warm.", "cli:onboarding");
    assert.deepEqual([first.added, first.doc.version, first.doc.author, first.doc.confirmedAt], [true, 1, "cli:onboarding", null]);
    const same = await context.set(base.id, "voice.md", "Plain and warm.\n", "cli:someone-else");
    assert.deepEqual([same.added, same.doc.version, same.doc.author], [false, 1, "cli:onboarding"], "the same text is not a new version");
    const second = await context.set(base.id, "voice.md", "Plain, warm, never formal.", "cli");
    assert.deepEqual([second.added, second.doc.version], [true, 2]);

    const history = await context.history(base.id, "voice.md");
    assert.deepEqual(history.map((v) => [v.version, v.author]), [[1, "cli:onboarding"], [2, "cli"]], "oldest first, each with who wrote it");
    assert.ok(history.every((v) => Math.abs(Date.parse(v.createdAt) - Date.now()) < 5 * 60_000), "and when");

    const read = await other.context.get(base.id, "voice.md");
    assert.deepEqual([read?.version, read?.author, read?.body], [2, "cli", "Plain, warm, never formal.\n"], "the newest version is the current one, through any core");
    await context.set(base.id, "derived/positioning.md", "For founders who do their own marketing.", "cli");
    const list = await other.context.list(base.id);
    assert.deepEqual(list.files.map((f) => [f.name, f.version, f.author]), [["derived/positioning.md", 1, "cli"], ["voice.md", 2, "cli"]]);
    assert.deepEqual(list.missing, ["product.md", "audience.md", "claims.md", "constraints.md"]);

    await assert.rejects(context.set(base.id, "notes.md", "x", "cli"), /is not a pack file/);
    await assert.rejects(context.set(base.id, "voice.md", " \n", "cli"), /has no text/);
    await assert.rejects(context.get(base.id, "../voice.md"), /is not a pack file/);
    await assert.rejects(context.history(base.id, "notes.md"), /is not a pack file/);
    assert.equal((await context.history(base.id, "voice.md")).length, 2, "a refused text adds nothing");
  } finally {
    await purge(core, tag);
    await core.close();
    await other.close();
  }
});

run("the pack belongs to the always-on base: a campaign under it reads and writes it, another base has its own, and it goes with its campaign", async () => {
  await migrate(process.env.DATABASE_URL!);
  const core = createCore(configFromEnv());
  const tag = newTag("owner");
  try {
    const { context } = core;
    const base = await core.campaigns.add({ name: `${tag}-base`, kind: "always_on" });
    const child = await core.campaigns.add({ name: `${tag}-launch`, kind: "campaign", parentId: base.id });
    const grandchild = await core.campaigns.add({ name: `${tag}-launch-week-1`, kind: "campaign", parentId: child.id });
    const stranger = await core.campaigns.add({ name: `${tag}-stranger`, kind: "always_on" });

    await context.set(child.id, "product.md", "A CLI for marketing.", "cli");
    assert.equal((await context.get(base.id, "product.md"))?.body, "A CLI for marketing.\n", "written through the campaign, read through its base");
    assert.equal((await context.get(grandchild.id, "product.md"))?.body, "A CLI for marketing.\n", "a campaign two levels down reads the company's pack, not its parent's");
    await context.set(base.id, "product.md", "A CLI for founders' marketing.", "cli");
    assert.deepEqual((await context.history(child.id, "product.md")).map((v) => v.version), [1, 2], "one file, one history");
    assert.deepEqual((await context.confirm(child.id, "cli")).map((v) => [v.name, v.version]), [["product.md", 2]]);
    assert.equal((await context.list(base.id)).files[0].confirmedBy, "cli");
    assert.deepEqual(await context.list(stranger.id), { files: [], missing: FIVE });
    await assert.rejects(context.list(randomUUID()), /No campaign with id/);

    const rows = async () => Number((await core.pool.query("select count(*) as n from context_doc where campaign_id = $1", [base.id])).rows[0].n);
    await core.pool.query("delete from campaign where id = any($1::uuid[])", [[grandchild.id]]);
    await core.pool.query("delete from campaign where id = $1", [child.id]);
    assert.equal(await rows(), 2, "the pack is its base's: it stays when a campaign under the base goes");
    await core.pool.query("delete from campaign where id = $1", [base.id]);
    assert.equal(await rows(), 0, "and goes with the base");
  } finally {
    await purge(core, tag);
    await core.close();
  }
});

run("confirmation: the current version of one file or of all gets who and when; a changed file is a draft again", async () => {
  await migrate(process.env.DATABASE_URL!);
  const core = createCore(configFromEnv());
  const tag = newTag("confirm");
  try {
    const { context } = core;
    const base = await core.campaigns.add({ name: `${tag}-base`, kind: "always_on" });
    await context.set(base.id, "voice.md", "Plain.", "cli:onboarding");
    await context.set(base.id, "claims.md", "- Free for open source | pricing page | open | all", "cli:onboarding");
    await context.set(base.id, "product.md", "A CLI for marketing.", "cli:onboarding");
    const confirmedBy = async () => Object.fromEntries((await context.list(base.id)).files.map((f) => [f.name, f.confirmedBy]));
    assert.deepEqual(await confirmedBy(), { "claims.md": null, "product.md": null, "voice.md": null }, "what is written is a draft");
    await assert.rejects(context.confirm(base.id, "cli", "audience.md"), /audience\.md does not exist yet/);
    await assert.rejects(context.confirm(base.id, "cli", "notes.md"), /is not a pack file/);

    const one = await context.confirm(base.id, "cli:roman", "voice.md");
    assert.deepEqual(one.map((v) => [v.name, v.version, v.confirmedBy]), [["voice.md", 1, "cli:roman"]]);
    assert.ok(Math.abs(Date.parse(one[0].confirmedAt!) - Date.now()) < 5 * 60_000, "with when");
    assert.deepEqual(await confirmedBy(), { "claims.md": null, "product.md": null, "voice.md": "cli:roman" }, "one file: the others stay drafts");

    assert.deepEqual((await context.confirm(base.id, "cli")).map((v) => v.name), ["claims.md", "product.md"], "all files: every draft");
    assert.deepEqual(await confirmedBy(), { "claims.md": "cli", "product.md": "cli", "voice.md": "cli:roman" }, "a confirmed version keeps its first confirmation");
    assert.deepEqual(await context.confirm(base.id, "cli"), [], "nothing is left to confirm");
    assert.deepEqual(await context.confirm(base.id, "cli", "voice.md"), []);

    assert.equal((await context.set(base.id, "voice.md", "Plain.", "cli")).doc.confirmedBy, "cli:roman", "the same text again leaves the confirmation");
    const changed = await context.set(base.id, "voice.md", "Plain and warm.", "cli:author");
    assert.deepEqual([changed.doc.version, changed.doc.confirmedAt, changed.doc.confirmedBy], [2, null, null]);
    assert.equal((await confirmedBy())["voice.md"], null, "a changed file is a draft again");
    assert.deepEqual((await context.history(base.id, "voice.md")).map((v) => [v.version, v.confirmedBy]), [[1, "cli:roman"], [2, null]], "the earlier version stays confirmed");
    assert.deepEqual((await context.confirm(base.id, "cli:roman")).map((v) => [v.name, v.version]), [["voice.md", 2]], "only the current version is confirmed");
  } finally {
    await purge(core, tag);
    await core.close();
  }
});

run("the pack as of a moment: of each file the newest version written by then, and a draft where it was confirmed only later", async () => {
  await migrate(process.env.DATABASE_URL!);
  const core = createCore(configFromEnv());
  const tag = newTag("as-of");
  try {
    const { context } = core;
    const base = await core.campaigns.add({ name: `${tag}-base`, kind: "always_on" });
    const child = await core.campaigns.add({ name: `${tag}-launch`, kind: "campaign", parentId: base.id });
    const product = (await context.set(base.id, "product.md", "A CLI for marketing.", "cli:onboarding")).doc;
    const [confirmed] = await context.confirm(base.id, "cli:founder", "product.md");
    const voice = (await context.set(base.id, "voice.md", "Plain.", "cli")).doc;
    // the moments are the database's own; a pause keeps what was written before one and after it apart
    await sleep(20);
    const rewritten = (await context.set(base.id, "product.md", "A CLI for founders' marketing.", "cli")).doc;
    await context.set(base.id, "audience.md", "Founders.", "cli");
    const [voiceConfirmed] = await context.confirm(base.id, "cli:founder", "voice.md");

    const then = new Date(Date.parse(rewritten.createdAt) - 1);
    assert.deepEqual(await context.asOf(child.id, then), [confirmed, voice],
      "just before product.md was rewritten: its first version, confirmed by then; voice.md as the draft it was; no audience.md yet");
    assert.deepEqual([confirmed.version, confirmed.confirmedBy, voice.confirmedAt], [1, "cli:founder", null]);
    assert.deepEqual(await context.asOf(base.id, new Date(Date.parse(product.createdAt) - 1)), [], "before anything was written the company had no pack");
    assert.deepEqual(await context.asOf(base.id, new Date(Date.parse(voiceConfirmed.confirmedAt!) + 1000)), (await context.list(base.id)).files, "after the last change: the pack of today");
    await assert.rejects(context.asOf(randomUUID(), then), /No campaign with id/);
  } finally {
    await purge(core, tag);
    await core.close();
  }
});

run("writers at the same moment each get their own version", async () => {
  await migrate(process.env.DATABASE_URL!);
  const core = createCore(configFromEnv());
  const tag = newTag("turns");
  try {
    const base = await core.campaigns.add({ name: `${tag}-base`, kind: "always_on" });
    const written = await Promise.all(Array.from({ length: 8 }, (_, i) => core.context.set(base.id, "derived/messages.md", `Draft of writer ${i}.`, `cli:writer-${i}`)));
    assert.deepEqual(written.map((w) => w.doc.version).sort((a, b) => a - b), [1, 2, 3, 4, 5, 6, 7, 8]);
    assert.equal(new Set((await core.context.history(base.id, "derived/messages.md")).map((v) => v.author)).size, 8, "nobody's text is lost");
  } finally {
    await purge(core, tag);
    await core.close();
  }
});

run("import: a pack kept on disk comes in once as version 1; the folder is only read and what the database has is left alone", async () => {
  await migrate(process.env.DATABASE_URL!);
  const core = createCore(configFromEnv());
  const tag = newTag("import");
  const dir = mkdtempSync(join(tmpdir(), "bw-pack-"));
  try {
    const { context } = core;
    const base = await core.campaigns.add({ name: `${tag}-base`, kind: "always_on" });
    const child = await core.campaigns.add({ name: `${tag}-launch`, kind: "campaign", parentId: base.id });
    const pack = join(dir, base.id);
    mkdirSync(join(pack, "derived"), { recursive: true });
    writeFileSync(join(pack, "product.md"), "A CLI for marketing.\n");
    writeFileSync(join(pack, "voice.md"), "Plain and warm.\n");
    writeFileSync(join(pack, "derived", "positioning.md"), "For founders.\n");
    writeFileSync(join(pack, "notes.md"), "Somebody's notes.\n");
    writeFileSync(join(pack, "claims.md"), "");
    writeFileSync(join(pack, "logo.png"), "not Markdown");
    mkdirSync(join(dir, "left-over"));
    writeFileSync(join(dir, "left-over", "voice.md"), "Of a campaign that is gone.\n");
    const folder = () => readdirSync(dir, { recursive: true, encoding: "utf8" }).sort().map((f) => [f, statSync(join(dir, f)).isFile() ? readFileSync(join(dir, f), "utf8") : null]);
    const before = folder();
    await context.set(base.id, "voice.md", "Rewritten in the database.", "cli");

    const first = await context.importDir(dir, "cli:import");
    assert.deepEqual(first.unknown, ["left-over"], "a folder that is named after no campaign is reported, not imported");
    assert.equal(first.packs.length, 1);
    const [report] = first.packs;
    assert.deepEqual([report.campaignId, report.campaignName, report.added, report.kept], [base.id, `${tag}-base`, ["derived/positioning.md", "product.md"], ["voice.md"]]);
    assert.deepEqual(report.skipped.map((s) => s.name), ["claims.md", "notes.md"], "an empty file and a file that is not a pack file; other file types are not looked at");
    assert.match(report.skipped[0].reason, /has no text/);
    assert.match(report.skipped[1].reason, /is not a pack file/);

    assert.deepEqual((await context.history(base.id, "product.md")).map((v) => [v.version, v.author, v.confirmedAt]), [[1, "cli:import", null]], "version 1, a draft, by whoever imported");
    assert.equal((await context.get(child.id, "derived/positioning.md"))?.body, "For founders.\n", "read through a campaign under the base, as it was on disk");
    assert.deepEqual((await context.history(base.id, "voice.md")).map((v) => v.author), ["cli"], "the database's own text is not touched");

    const second = await context.importDir(dir, "cli:import");
    assert.deepEqual([second.packs[0].added, second.packs[0].kept], [[], ["derived/positioning.md", "product.md", "voice.md"]], "a second import adds nothing");
    assert.equal((await context.history(base.id, "product.md")).length, 1);
    assert.deepEqual(folder(), before, "the folder is as it was");
    await assert.rejects(context.importDir(join(dir, "nowhere"), "cli"), /No folder at .*nowhere/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
    await purge(core, tag);
    await core.close();
  }
});
