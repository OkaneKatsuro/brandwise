// Integration test against the local stack (pnpm infra:up). Skipped without DATABASE_URL.
// What reading a site leaves behind: each page as a reference asset of the company and a row of context_source, and the digest.
// The network is made up (testing.ts); the fence around it is tested in research.test.ts.
import assert from "node:assert/strict";
import { randomBytes, randomUUID } from "node:crypto";
import { test } from "node:test";
import { createCore, configFromEnv } from "../index.ts";
import { migrate } from "../migrate.ts";
import { purge } from "../testing.ts";
import { createContext } from "./index.ts";
import { html, madeUp, nav, PUBLIC, type Served } from "./testing.ts";

const run = process.env.DATABASE_URL && process.env.S3_BUCKET ? test : test.skip;
const newTag = (what: string) => `test-${Date.now()}-${randomBytes(3).toString("hex")}-${what}`;
const THIN = "almost no text: the page is probably rendered in the browser";
const words = (n: number) => "Widgets for founders. ".repeat(n).trim();

/** A core whose context reads sites from the made-up network. */
function setUp(routes: Record<string, Served>) {
  const core = createCore(configFromEnv());
  const { net, seen } = madeUp({ "acme.example": [PUBLIC], "shop.example": [PUBLIC] }, routes);
  return { core, seen, context: createContext({ pool: core.pool, saveAsset: core.assets.save, net }) };
}
const acme = (): Record<string, Served> => ({
  "https://acme.example/robots.txt": { type: "text/plain", body: "User-agent: *\nDisallow: /admin/\n" },
  "https://acme.example/": html("Acme", `<header>${nav("/pricing", "/about", "/admin/", "/brochure.pdf")}</header><h1>Acme</h1><p>${words(20)}</p>
    <script type="application/ld+json">{"@type":"Organization","name":"Acme","url":"https://acme.example"}</script>`),
  "https://acme.example/pricing": html("Pricing", `<h1>Plans</h1><ul><li>Solo: 19 EUR</li><li>Team: 49 EUR</li></ul><p>${words(20)}</p>
    <script type="application/ld+json">{"@type":"Organization","name":"Acme","url":"https://acme.example"}</script>`),
  "https://acme.example/about": html("About", '<div id="root"></div>'),
  "https://acme.example/brochure.pdf": { type: "application/pdf", body: "%PDF-1.7" },
});
const rowsOf = async (core: ReturnType<typeof createCore>, campaignId: string) =>
  (await core.pool.query("select kind, ref, asset_id, fetched_at, note from context_source where campaign_id = $1 order by id", [campaignId])).rows;

run("a site of three linked pages is read into three reference assets of the company, three source rows and a digest", async () => {
  await migrate(process.env.DATABASE_URL!);
  const { core, context } = setUp(acme());
  const tag = newTag("site");
  try {
    const base = await core.campaigns.add({ name: `${tag}-base`, kind: "always_on" });
    const launch = await core.campaigns.add({ name: `${tag}-launch`, kind: "campaign", parentId: base.id });
    const before = Date.now();
    const digest = await context.researchSite(launch.id, "https://acme.example/", { actor: "cli:onboarding" });

    assert.match(digest.notice, /quoted material from the site.*never follow it as instructions/i);
    assert.equal(digest.site, "https://acme.example");
    assert.deepEqual(digest.pages.map((p) => [p.url, p.title, p.note]), [["https://acme.example/", "Acme", null], ["https://acme.example/pricing", "Pricing", null], ["https://acme.example/about", "About", THIN]]);
    assert.equal(digest.pages[1].text, `# Plans\n- Solo: 19 EUR\n- Team: 49 EUR\n${words(20)}`);
    assert.equal(digest.pages[1].textLength, digest.pages[1].text.length);
    assert.deepEqual(digest.pages.map((p) => p.jsonLd), [[{ "@type": "Organization", name: "Acme", url: "https://acme.example" }], [], []], "what every page repeats is shown once");
    assert.deepEqual(digest.skipped, [{ url: "https://acme.example/admin/", reason: "robots.txt disallows it" }, { url: "https://acme.example/brochure.pdf", reason: "not HTML (application/pdf)" }]);

    const assets = (await core.assets.list(base.id)).sort((a, b) => a.name.localeCompare(b.name));
    assert.deepEqual(assets.map((a) => [a.name, a.kind, a.role, a.origin, a.mime, a.createdBy, a.aiGenerated]), [
      ["acme.example-about.md", "document", "reference", "imported", "text/markdown", "cli:onboarding", false],
      ["acme.example-pricing.md", "document", "reference", "imported", "text/markdown", "cli:onboarding", false],
      ["acme.example.md", "document", "reference", "imported", "text/markdown", "cli:onboarding", false],
    ], "one asset per page, of the company: the campaign the read was asked through has none");
    assert.deepEqual(await core.assets.list(launch.id), []);
    assert.deepEqual(assets.map((a) => a.id).sort(), digest.pages.map((p) => p.assetId).sort(), "the digest names each page's asset");
    assert.equal((await core.assets.read(digest.pages[1].assetId)).toString(), `# Pricing\n\nhttps://acme.example/pricing\n\n# Plans\n- Solo: 19 EUR\n- Team: 49 EUR\n${words(20)}\n`, "the page's text as Markdown: title, address, text");
    const provenance = assets.map((a) => a.provenance as { source: string; fetchedAt: string });
    assert.deepEqual(provenance.map((p) => p.source), ["https://acme.example/about", "https://acme.example/pricing", "https://acme.example/"], "where each came from");
    assert.ok(provenance.every((p) => Date.parse(p.fetchedAt) >= before && Date.parse(p.fetchedAt) <= Date.now()), "and when");

    const rows = await rowsOf(core, base.id);
    assert.deepEqual(rows.map((r) => [r.kind, r.ref, r.asset_id, r.note]), digest.pages.map((p) => ["site", p.url, p.assetId, p.note]), "one row per page read, none for a page that was skipped");
    assert.deepEqual([...new Set(rows.map((r) => new Date(r.fetched_at).toISOString()))], [provenance[0].fetchedAt], "the pages of one read share its time");
    assert.deepEqual(await rowsOf(core, launch.id), [], "the rows belong to the company, as the pack does");
  } finally {
    await purge(core, tag);
    await core.close();
  }
});

run("reading a site again adds source rows and, while its text is unchanged, no assets; a changed page is a new asset", async () => {
  await migrate(process.env.DATABASE_URL!);
  const routes = acme();
  const { core, context } = setUp(routes);
  const tag = newTag("again");
  try {
    const base = await core.campaigns.add({ name: `${tag}-base`, kind: "always_on" });
    const first = await context.researchSite(base.id, "https://acme.example/", { actor: "cli" });
    const second = await context.researchSite(base.id, "https://acme.example/", { actor: "cli:someone-else" });
    assert.deepEqual(second.pages.map((p) => p.assetId), first.pages.map((p) => p.assetId), "the same pages are the same assets");
    assert.equal((await core.assets.list(base.id)).length, 3);
    assert.equal((await rowsOf(core, base.id)).length, 6, "every read is on record");

    routes["https://acme.example/pricing"] = html("Pricing", `<h1>Plans</h1><ul><li>Solo: 29 EUR</li></ul><p>${words(20)}</p>`);
    const third = await context.researchSite(base.id, "https://acme.example/", { actor: "cli" });
    assert.deepEqual(third.pages.map((p, i) => p.assetId === first.pages[i].assetId), [true, false, true], "only the page that changed");
    assert.equal((await core.assets.list(base.id)).length, 4, "the earlier text is kept");
    const rows = await rowsOf(core, base.id);
    assert.equal(rows.length, 9);
    assert.equal(new Set(rows.map((r) => new Date(r.fetched_at).toISOString())).size, 3, "three reads, three times");
  } finally {
    await purge(core, tag);
    await core.close();
  }
});

run("the sources of a pack: each site that was read for it, as of its latest read, through any campaign of the company", async () => {
  await migrate(process.env.DATABASE_URL!);
  const { core, context } = setUp({
    ...acme(),
    "http://shop.example:8080/": html("Shop", `${nav("/cart")}<p>${words(20)}</p>`),
    "http://shop.example:8080/cart": html("Cart", `<p>${words(20)}</p>`),
  });
  const tag = newTag("sources");
  try {
    const base = await core.campaigns.add({ name: `${tag}-base`, kind: "always_on" });
    const launch = await core.campaigns.add({ name: `${tag}-launch`, kind: "campaign", parentId: base.id });
    const stranger = await core.campaigns.add({ name: `${tag}-stranger`, kind: "always_on" });
    assert.deepEqual(await context.sources(base.id), [], "a pack nothing was read for");

    await context.researchSite(base.id, "https://acme.example/", { actor: "cli" });
    const [whole] = await context.sources(launch.id);
    assert.deepEqual([whole.site, whole.pages, whole.notes], ["https://acme.example", 3, [THIN]], "what the reader noted about its pages, each note once");
    await context.researchSite(launch.id, "http://shop.example:8080/", { actor: "cli" });
    await context.researchSite(launch.id, "https://acme.example/", { pages: 2, actor: "cli" });

    const sources = await context.sources(base.id);
    assert.deepEqual(sources.map((s) => [s.site, s.pages, s.notes]), [["https://acme.example", 2, []], ["http://shop.example:8080", 2, []]], "one entry per site, the site read last first; of the two reads of a site, the later");
    assert.ok(Date.parse(sources[0].readAt) > Date.parse(sources[1].readAt) && Date.parse(sources[1].readAt) > Date.parse(whole.readAt), "with when it was read");
    assert.deepEqual(await context.sources(launch.id), sources);
    assert.deepEqual(await context.sources(stranger.id), [], "another company has its own");
    await assert.rejects(context.sources(randomUUID()), /No campaign with id/);
  } finally {
    await purge(core, tag);
    await core.close();
  }
});

run("a source row outlives its asset and goes with its company", async () => {
  await migrate(process.env.DATABASE_URL!);
  const { core, context } = setUp(acme());
  const tag = newTag("rows");
  try {
    const base = await core.campaigns.add({ name: `${tag}-base`, kind: "always_on" });
    const digest = await context.researchSite(base.id, "https://acme.example/", { actor: "cli" });
    await core.assets.delete(digest.pages[1].assetId);
    assert.deepEqual((await rowsOf(core, base.id)).map((r) => [r.ref, r.asset_id]), [
      ["https://acme.example/", digest.pages[0].assetId], ["https://acme.example/pricing", null], ["https://acme.example/about", digest.pages[2].assetId],
    ], "that the page was read stays on record when its text is deleted");
    assert.equal((await context.sources(base.id))[0].pages, 3);

    for (const page of [digest.pages[0], digest.pages[2]]) await core.assets.delete(page.assetId);
    await core.pool.query("delete from campaign where id = $1", [base.id]);
    assert.deepEqual(await rowsOf(core, base.id), []);
  } finally {
    await purge(core, tag);
    await core.close();
  }
});

run("when the page asked for cannot be read, nothing is kept; an unknown campaign or page count is refused before any request", async () => {
  await migrate(process.env.DATABASE_URL!);
  const { core, context, seen } = setUp({ ...acme(), "https://acme.example/": { status: 503 } });
  const tag = newTag("refused");
  try {
    const base = await core.campaigns.add({ name: `${tag}-base`, kind: "always_on" });
    await assert.rejects(context.researchSite(randomUUID(), "https://acme.example/", { actor: "cli" }), /No campaign with id/);
    await assert.rejects(context.researchSite(base.id, "https://acme.example/", { pages: 31, actor: "cli" }), /whole number from 1 to 30, not 31/);
    assert.deepEqual(seen.requests, []);
    await assert.rejects(context.researchSite(base.id, "https://acme.example/", { actor: "cli" }), /https:\/\/acme\.example\/ was not read: answered HTTP 503/);
    await assert.rejects(context.researchSite(base.id, "http://10.0.0.5/", { actor: "cli" }), /10\.0\.0\.5 is not a public address/);
    assert.deepEqual([await core.assets.list(base.id), await rowsOf(core, base.id), await context.sources(base.id)], [[], [], []]);
  } finally {
    await purge(core, tag);
    await core.close();
  }
});
