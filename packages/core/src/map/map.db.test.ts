// Integration test against the local stack (pnpm infra:up). Skipped without DATABASE_URL.
// The company map as it is read from Postgres: a company's own rows and no other's become its nodes and edges, the reads are
// bounded and say what they leave out, a result carries what the metrics service says, and a post knows the pack it was written from.
import assert from "node:assert/strict";
import { randomBytes, randomUUID } from "node:crypto";
import { test } from "node:test";
import { setTimeout as sleep } from "node:timers/promises";
import { mock } from "../connector-mock.ts";
import { createContext } from "../context/index.ts";
import { html, madeUp, nav, PUBLIC } from "../context/testing.ts";
import { createCore, configFromEnv } from "../index.ts";
import { createMetrics } from "../metrics/index.ts";
import { metricsStore } from "../metrics/store.ts";
import { migrate } from "../migrate.ts";
import { runDue } from "../publish.ts";
import { purge } from "../testing.ts";
import { POSTS_SHOWN, UNUSED_CREATIVES_SHOWN, type MapEdge } from "./index.ts";

const run = process.env.DATABASE_URL && process.env.S3_BUCKET ? test : test.skip;
const newTag = (what: string) => `test-${Date.now()}-${randomBytes(3).toString("hex")}-${what}`;
const HOUR = 3_600_000, DAY = 24 * HOUR;
const pairs = (edges: MapEdge[]) => edges.map((e) => `${e.from} -> ${e.to}`);
const ago = (ms: number) => new Date(Date.now() - ms).toISOString();

run("a company's site, pack, campaigns, creatives, posts and results are read into exactly its nodes and edges, and nothing of another company", async () => {
  await migrate(process.env.DATABASE_URL!);
  const core = createCore(configFromEnv());
  const tag = newTag("map");
  try {
    const acme = await core.campaigns.add({ name: `${tag}-acme`, kind: "always_on" });
    const launch = await core.campaigns.add({ name: `${tag}-launch`, kind: "campaign", parentId: acme.id });
    const stranger = await core.campaigns.add({ name: `${tag}-stranger`, kind: "always_on" });

    // the site is read through a campaign of the company, and belongs to the company
    const { net } = madeUp({ "acme.example": [PUBLIC] }, {
      "https://acme.example/robots.txt": { type: "text/plain", body: "User-agent: *\nAllow: /\n" },
      "https://acme.example/": html("Acme", `<header>${nav("/pricing")}</header><p>${"Widgets for founders. ".repeat(20)}</p>`),
      "https://acme.example/pricing": html("Pricing", `<p>${"Solo: 19 EUR. ".repeat(20)}</p>`),
    });
    await createContext({ pool: core.pool, saveAsset: core.assets.save, net }).researchSite(launch.id, "https://acme.example/", { actor: "test" });
    await core.context.set(acme.id, "product.md", "Widgets for founders.", "cli");
    await core.context.set(acme.id, "voice.md", "Plain and warm.", "cli");
    await core.context.confirm(acme.id, "cli:founder", "voice.md");
    await core.context.set(stranger.id, "product.md", "Something else.", "cli");

    const creative = (campaignId: string, name: string, provenance?: unknown) => core.assets.save({ campaignId, bytes: Buffer.from(`${tag}-${name}`), filename: `${name}.png`, role: "creative", origin: "generated", provenance });
    const hero = await creative(launch.id, "hero", { model: "test", prompt: "A widget on a desk", style: { id: "product-hero", version: 1, origin: "built-in" } });
    const teaser = await creative(launch.id, "teaser", { model: "test", prompt: "The widget, closer" });
    const logo = await creative(acme.id, "logo");
    await creative(stranger.id, "theirs");
    const page = (await core.assets.list(acme.id)).find((a) => a.role === "reference")!;
    await core.pool.query("insert into asset_link (parent_id, child_id, relation) values ($1, $2, 'derived_from'), ($3, $1, 'used_in')", [hero.id, teaser.id, logo.id]);

    const post = (campaignId: string, title: string, scheduledAt: string, tier: 1 | 2, assetId?: string) => core.calendar.add({ campaignId, title, channel: "mock", scheduledAt, tier, assetId, body: `${title}.` });
    const soon = await post(launch.id, "Teaser", new Date(Date.now() + DAY).toISOString(), 2, teaser.id);
    const launched = await post(launch.id, "Launch day", ago(60_000), 1, hero.id);
    const thanks = await post(acme.id, "Thanks", ago(120_000), 1);
    const pricing = await post(acme.id, "Pricing page", ago(180_000), 1, page.id);
    const theirs = await post(stranger.id, "Theirs", ago(60_000), 1);
    assert.deepEqual((await runDue(core, [mock], 10, [acme.id, launch.id, stranger.id])).map((o) => o.result), ["published", "published", "published", "published"]);

    // what the platform said: views and clicks of two posts, only reactions of a third, nothing of the fourth
    const points = metricsStore(core.pool), startedAt = ago(HOUR), seen = new Date(Date.now() - 1000);
    await points.write("platform", [
      { entryId: launched.id, startedAt, values: { exposures: 400, clicks: 8 } },
      { entryId: thanks.id, startedAt, values: { reactions: 3 } },
      { entryId: theirs.id, startedAt, values: { exposures: 9000, clicks: 90 } },
    ], seen);
    const metrics = createMetrics({ core, sources: [] }), now = new Date();

    const map = await core.map.company(launch.id, metrics, now);
    const [site] = await core.context.sources(acme.id);
    assert.equal(map.rootId, acme.id, "asked through a campaign: the map of its company");
    assert.deepEqual(map.nodes, [
      { id: "source:https://acme.example", column: "source", order: 0, site: "https://acme.example", readAt: site.readAt, pages: 2 },
      { id: "pack", column: "pack", order: 0, files: [{ name: "product.md", version: 1, confirmed: false }, { name: "voice.md", version: 1, confirmed: true }], missing: ["audience.md", "claims.md", "constraints.md"] },
      { id: `campaign:${acme.id}`, column: "campaign", order: 0, campaignId: acme.id, name: acme.name, kind: "always_on", hidden: { creatives: 0, posts: 0 } },
      { id: `campaign:${launch.id}`, column: "campaign", order: 1, campaignId: launch.id, name: launch.name, kind: "campaign", hidden: { creatives: 0, posts: 0 } },
      { id: `creative:${logo.id}`, column: "creative", order: 0, assetId: logo.id, campaignId: acme.id, name: "logo.png", kind: "image", style: null, prompt: null },
      { id: `creative:${teaser.id}`, column: "creative", order: 1, assetId: teaser.id, campaignId: launch.id, name: "teaser.png", kind: "image", style: null, prompt: "The widget, closer" },
      { id: `creative:${hero.id}`, column: "creative", order: 2, assetId: hero.id, campaignId: launch.id, name: "hero.png", kind: "image", style: "product-hero", prompt: "A widget on a desk" },
      { id: `post:${soon.id}`, column: "post", order: 0, entryId: soon.id, campaignId: launch.id, title: "Teaser", channel: "mock", status: "pending_approval", scheduledAt: soon.scheduledAt },
      { id: `post:${launched.id}`, column: "post", order: 1, entryId: launched.id, campaignId: launch.id, title: "Launch day", channel: "mock", status: "published", scheduledAt: launched.scheduledAt },
      { id: `post:${thanks.id}`, column: "post", order: 2, entryId: thanks.id, campaignId: acme.id, title: "Thanks", channel: "mock", status: "published", scheduledAt: thanks.scheduledAt },
      { id: `post:${pricing.id}`, column: "post", order: 3, entryId: pricing.id, campaignId: acme.id, title: "Pricing page", channel: "mock", status: "published", scheduledAt: pricing.scheduledAt },
      // one post has views: the one with reactions only, the one without numbers and the one not published have no result
      { id: `result:${launched.id}`, column: "result", order: 0, entryId: launched.id, exposures: 400, clicks: 8, verdict: "unknown", ratio: null },
    ], "newest on top in every column; the pages read from the site are references, not creatives");
    assert.deepEqual(pairs(map.edges), [
      "source:https://acme.example -> pack",
      `pack -> campaign:${acme.id}`,
      `campaign:${acme.id} -> campaign:${launch.id}`,
      `campaign:${acme.id} -> creative:${logo.id}`,
      `campaign:${launch.id} -> creative:${teaser.id}`,
      `campaign:${launch.id} -> creative:${hero.id}`,
      `creative:${hero.id} -> creative:${teaser.id}`,
      `creative:${teaser.id} -> post:${soon.id}`,
      `creative:${hero.id} -> post:${launched.id}`,
      `campaign:${acme.id} -> post:${thanks.id}`,
      `campaign:${acme.id} -> post:${pricing.id}`,
      `post:${launched.id} -> result:${launched.id}`,
    ], "a link of another relation is not an edge, and a post that uses a page of the site hangs on its campaign");

    assert.deepEqual(await core.map.company(acme.id, metrics, now), map, "the same map through the company itself");
    assert.deepEqual((await core.map.company(launch.id, metrics, new Date(seen.getTime() - 1000))).nodes.filter((n) => n.column === "result"), [], "as of a moment before the numbers were known");
    await assert.rejects(core.map.company(randomUUID(), metrics, now), /No campaign with id/);
  } finally {
    await purge(core, tag);
    await core.close();
  }
});

run(`the map shows the newest ${POSTS_SHOWN} posts, the creatives they use and the newest ${UNUSED_CREATIVES_SHOWN} creatives no post uses, and each campaign counts the rest`, async () => {
  await migrate(process.env.DATABASE_URL!);
  const core = createCore(configFromEnv());
  const tag = newTag("map-bounds");
  try {
    const acme = await core.campaigns.add({ name: `${tag}-acme`, kind: "always_on" });
    const launch = await core.campaigns.add({ name: `${tag}-launch`, kind: "campaign", parentId: acme.id });
    const start = "2026-01-01T00:00:00Z";
    // written as rows: 45 posts and 25 creatives through the calendar and the storage would only test those again.
    // The posts are an hour apart, every third in the campaign, and drafts, so that no scheduler takes them
    await core.pool.query(
      `insert into content_calendar (campaign_id, title, channel, scheduled_at, tier, status)
       select case when n % 3 = 0 then $2::uuid else $1::uuid end, 'Post ' || n, 'mock', $3::timestamptz + n * interval '1 hour', 2, 'draft' from generate_series(1, 45) n`,
      [acme.id, launch.id, start]);
    // 23 creatives of the company that no post uses, a minute apart, and before them two of the campaign that posts will use
    const assets = (await core.pool.query(
      `insert into asset (campaign_id, name, kind, role, origin, storage_key, sha256, mime, bytes, created_by, created_at)
       select case when n < 1 then $2::uuid else $1::uuid end, case n when -1 then 'in an old post' when 0 then 'in a new post' else 'Unused ' || n end, 'image', 'creative', 'uploaded',
              'test/' || $3::text || '/' || n, md5($3::text || n), 'image/png', 1, 'test', $4::timestamptz + n * interval '1 minute'
       from generate_series(-1, 23) n returning id, name`,
      [acme.id, launch.id, tag, start])).rows as { id: string; name: string }[];
    const assetId = (name: string) => assets.find((a) => a.name === name)!.id;
    await core.pool.query("update content_calendar set asset_id = $2 where campaign_id = $1 and title = 'Post 45'", [launch.id, assetId("in a new post")]);
    await core.pool.query("update content_calendar set asset_id = $2 where campaign_id = $1 and title = 'Post 3'", [launch.id, assetId("in an old post")]);

    const map = await core.map.company(acme.id, createMetrics({ core, sources: [] }), new Date());
    const titles = map.nodes.flatMap((n) => (n.column === "post" ? [n.title] : []));
    assert.deepEqual(titles, Array.from({ length: POSTS_SHOWN }, (_, i) => `Post ${45 - i}`), "the newest posts, newest first");
    const creatives = map.nodes.flatMap((n) => (n.column === "creative" ? [n.name] : []));
    assert.deepEqual(creatives, [...Array.from({ length: UNUSED_CREATIVES_SHOWN }, (_, i) => `Unused ${23 - i}`), "in a new post"], "the newest unused creatives and the one a shown post uses; not the one only an older post uses");
    assert.deepEqual(map.nodes.flatMap((n) => (n.column === "campaign" ? [[n.campaignId, n.hidden]] : [])), [
      [acme.id, { creatives: 3, posts: 4 }],
      [launch.id, { creatives: 1, posts: 1 }],
    ], "left out: posts 1 to 5 and unused creatives 1 to 3, counted where they belong");
    const newest = map.nodes.find((n) => n.column === "post" && n.title === "Post 45")!;
    assert.deepEqual(pairs(map.edges.filter((e) => e.to === newest.id)), [`creative:${assetId("in a new post")} -> ${newest.id}`]);
    assert.equal(map.edges.length, 1 + 21 + POSTS_SHOWN, "the campaign under the company, each creative from its campaign, each post from its creative or campaign; an empty pack is linked to nothing");
  } finally {
    await purge(core, tag);
    await core.close();
  }
});

run("a result carries the post's views and clicks as of the moment asked, and the verdict of the metrics service with its ratio", async () => {
  await migrate(process.env.DATABASE_URL!);
  const core = createCore(configFromEnv());
  const tag = newTag("map-results");
  try {
    const acme = await core.campaigns.add({ name: `${tag}-acme`, kind: "always_on" });
    // five ordinary posts, then one seen four times as often a day after it went out and shared as often as they were, then one of an hour ago
    const plans = [
      ...[9, 8, 7, 6, 5].map((daysAgo) => ({ title: `Earlier ${daysAgo}`, daysAgo, totals: { 24: { exposures: 1000, shares: 10, clicks: 5 } } })),
      { title: "Hit", daysAgo: 3, totals: { 24: { exposures: 4000, shares: 40, clicks: 80 }, 48: { exposures: 6000, shares: 60, clicks: 110 } } },
      { title: "Young", daysAgo: 1 / 24, totals: { 0.5: { exposures: 300, shares: 3 } } },
    ];
    const ids = new Map<string, string>();
    for (const p of plans) ids.set(p.title, (await core.calendar.add({ campaignId: acme.id, title: p.title, channel: "mock", scheduledAt: ago(60_000), tier: 1 })).id);
    assert.ok((await runDue(core, [mock], plans.length, [acme.id])).every((o) => o.result === "published"));
    const now = new Date(), points = metricsStore(core.pool);
    for (const p of plans) {
      const startedAt = new Date(now.getTime() - p.daysAgo * DAY);
      for (const [hours, values] of Object.entries(p.totals)) await points.write("platform", [{ entryId: ids.get(p.title)!, startedAt: startedAt.toISOString(), values }], new Date(startedAt.getTime() + Number(hours) * HOUR));
    }
    const metrics = createMetrics({ core, sources: [] });
    const results = async (asOf: Date) => new Map((await core.map.company(acme.id, metrics, asOf)).nodes.flatMap((n) => (n.column === "result" ? [[n.entryId, n] as const] : [])));

    const all = await results(now);
    assert.equal(all.size, plans.length);
    const hit = all.get(ids.get("Hit")!)!;
    assert.deepEqual([hit.exposures, hit.clicks, hit.verdict, hit.ratio], [6000, 110, "viral", 4], "today's totals, and the verdict taken from the views a day after it went out against the five before it");
    const [judged] = await metrics.virality(acme, now, { entryIds: [hit.entryId] });
    assert.deepEqual([hit.verdict, hit.ratio], [judged.verdict, judged.ages["24h"].ratio], "what `metrics virality` says of the same entry");
    const young = all.get(ids.get("Young")!)!;
    assert.deepEqual([young.exposures, young.clicks, young.verdict, young.ratio], [300, null, "unknown", null], "an hour old: no verdict yet, and clicks nobody measured are unknown, not zero");
    assert.deepEqual([...all.values()].filter((r) => r.verdict !== "unknown").length, 1, "the five before it have too little history of their own");

    const early = await results(new Date(now.getTime() - 3 * DAY + 30 * HOUR));
    assert.deepEqual([...early.keys()].sort(), ["Earlier 9", "Earlier 8", "Earlier 7", "Earlier 6", "Earlier 5", "Hit"].map((t) => ids.get(t)!).sort(), "as of thirty hours after the hit: the post of an hour ago had no numbers");
    assert.deepEqual([early.get(hit.entryId)!.exposures, early.get(hit.entryId)!.verdict], [4000, "viral"]);
  } finally {
    await purge(core, tag);
    await core.close();
  }
});

run("a post's details are its text and the pack as it stood when the entry was created", async () => {
  await migrate(process.env.DATABASE_URL!);
  const core = createCore(configFromEnv());
  const tag = newTag("map-post");
  try {
    const acme = await core.campaigns.add({ name: `${tag}-acme`, kind: "always_on" });
    const launch = await core.campaigns.add({ name: `${tag}-launch`, kind: "campaign", parentId: acme.id });
    await core.context.set(acme.id, "product.md", "Widgets.", "cli");
    await core.context.confirm(acme.id, "cli:founder");
    await core.context.set(acme.id, "voice.md", "Plain.", "cli");
    // the database's clock orders these: a pause keeps what came before the entry and what came after it apart
    await sleep(20);
    const entry = await core.calendar.add({ campaignId: launch.id, title: "Launch day", channel: "mock", scheduledAt: new Date(Date.now() + DAY).toISOString(), tier: 2, body: "We are live." });
    await sleep(20);
    await core.context.set(acme.id, "product.md", "Widgets for founders.", "cli");
    await core.context.set(acme.id, "audience.md", "Founders.", "cli");
    await core.context.confirm(acme.id, "cli:founder");

    assert.deepEqual(await core.map.post(entry.id), {
      entryId: entry.id, text: "We are live.",
      pack: [{ name: "product.md", version: 1, confirmed: true }, { name: "voice.md", version: 1, confirmed: false }],
    }, "the company's pack, through a campaign under it: not the version written later, not the file added later, not the confirmation given later");
    assert.deepEqual((await core.context.list(acme.id)).files.map((f) => [f.name, f.version, f.confirmedBy]), [["audience.md", 1, "cli:founder"], ["product.md", 2, "cli:founder"], ["voice.md", 1, "cli:founder"]], "while the pack of today has moved on");
    await assert.rejects(core.map.post("no-such-entry"), /No calendar entry with id no-such-entry/);
  } finally {
    await purge(core, tag);
    await core.close();
  }
});
