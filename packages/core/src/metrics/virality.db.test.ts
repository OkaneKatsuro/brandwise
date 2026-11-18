// Integration test against the local stack (pnpm infra:up). Skipped without DATABASE_URL.
// Proves the reads behind `metrics virality` and `metrics styles`: each entry's numbers as of its own ages from the stored snapshots,
// the baseline over the company (not one campaign, not another company), the company's viral ratio, and the style from the creative.
import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { test } from "node:test";
import { mock } from "../connector-mock.ts";
import { createCore, configFromEnv, type Campaign } from "../index.ts";
import { migrate } from "../migrate.ts";
import { runDue } from "../publish.ts";
import { purge } from "../testing.ts";
import { createMetrics, type Snapshot } from "./index.ts";
import { metricsStore } from "./store.ts";

const run = process.env.DATABASE_URL && process.env.S3_BUCKET ? test : test.skip;
const HOUR = 3_600_000, DAY = 24 * HOUR;

run("virality: numbers as of each entry's own ages, judged against the whole company and only it; the company's ratio; styles from the creatives", async () => {
  await migrate(process.env.DATABASE_URL!);
  const core = createCore(configFromEnv());
  const tag = `test-${Date.now()}-${randomBytes(3).toString("hex")}-virality`;
  try {
    const company = await core.campaigns.add({ name: `${tag}-company`, kind: "always_on" });
    const launch = await core.campaigns.add({ name: `${tag}-launch`, kind: "campaign", parentId: company.id });
    const stranger = await core.campaigns.add({ name: `${tag}-stranger`, kind: "always_on" });
    const creative = (name: string, provenance: unknown) => core.assets.save({ campaignId: launch.id, bytes: Buffer.from(`${tag}-${name}`), filename: `${name}.png`, role: "creative", origin: "generated", provenance });
    const hero = await creative("hero", { model: "test", style: { id: "product-hero", version: 1, origin: "builtin" } });
    const plain = await creative("plain", { model: "test" });

    // what the platform will have said about each post: when it reached its audience (days ago) and its running totals, by hours after that
    type Plan = { title: string; campaign: Campaign; channel: string; daysAgo: number; totals: Record<number, Snapshot["values"]>; assetId?: string };
    // an ordinary post: `views` at 24 hours with 1 % of the viewers sharing it, four times that by day seven and five times by now
    const usual = (views: number): Plan["totals"] => ({ 1: { exposures: 100, shares: 1 }, 24: { exposures: views, shares: views / 100 }, 160: { exposures: views * 4, shares: views / 25 }, 200: { exposures: views * 5, shares: views / 20 } });
    const plans: Plan[] = [
      // older than the previous 20, with numbers that would move the median if they counted
      ...[40, 39].map((daysAgo): Plan => ({ title: `Old ${daysAgo}`, campaign: company, channel: "mock", daysAgo, totals: usual(100_000) })),
      // the 20 before the posts in question, half in the company's base and half in a campaign under it. At 24 hours eight have 1,000
      // views, the base's other six 500 and the campaign's other six 1,500: the median is 1,000 over the company, 500 and 1,500 apart
      ...Array.from({ length: 20 }, (_, i): Plan => ({ title: `Earlier ${i}`, campaign: i % 2 ? launch : company, channel: "mock", daysAgo: 30 - i, totals: usual(i % 10 < 4 ? 1000 : i % 2 ? 1500 : 500) })),
      { title: "Hit", campaign: launch, channel: "mock", daysAgo: 3, totals: { 1: { exposures: 300, shares: 3 }, 24: { exposures: 4000, shares: 40 }, 48: { exposures: 6000, shares: 60 } }, assetId: hero.id },
      { title: "Reach only", campaign: company, channel: "mock", daysAgo: 2, totals: { 1: { exposures: 100, shares: 0 }, 24: { exposures: 4000, shares: 0 } }, assetId: plain.id },
      { title: "Young", campaign: company, channel: "mock", daysAgo: 5 / 24, totals: { 1: { exposures: 250, shares: 2 }, 4: { exposures: 800, shares: 8 } } },
      // a channel with three posts, and another company whose posts must not enter this one's baseline
      ...[9, 8, 7].map((daysAgo): Plan => ({ title: `Story ${daysAgo}`, campaign: company, channel: "story", daysAgo, totals: usual(1000) })),
      ...[6, 5, 4].map((daysAgo): Plan => ({ title: `Stranger ${daysAgo}`, campaign: stranger, channel: "mock", daysAgo, totals: usual(100_000) })),
    ];
    const ids = new Map<string, string>();
    for (const p of plans) {
      const e = await core.calendar.add({ campaignId: p.campaign.id, title: p.title, channel: p.channel, scheduledAt: new Date(Date.now() - 60_000).toISOString(), tier: 1, assetId: p.assetId });
      ids.set(p.title, e.id);
    }
    for (const o of await runDue(core, [mock], plans.length, [company.id, launch.id, stranger.id])) {
      // "story" has no connector: a person posted it in the app and recorded it
      if (o.result === "needs_manual") await core.publishing.publishedByHand(o.id, { externalId: `story-${o.id}` }, "test");
      else assert.equal(o.result, "published");
    }
    const now = new Date();
    const points = metricsStore(core.pool);
    for (const p of plans) {
      const startedAt = new Date(now.getTime() - p.daysAgo * DAY);
      for (const [hours, values] of Object.entries(p.totals)) {
        const observedAt = new Date(startedAt.getTime() + Number(hours) * HOUR);
        if (observedAt <= now) await points.write("platform", [{ entryId: ids.get(p.title)!, startedAt: startedAt.toISOString(), values }], observedAt);
      }
    }
    const metrics = createMetrics({ core, sources: [] });
    const titled = async (campaign: Campaign, asOf = now, opts?: { channel?: string; last?: number; entryIds?: string[] }) => new Map((await metrics.virality(campaign, asOf, opts)).map((v) => [v.title, v]));

    const all = await titled(company);
    assert.equal(all.size, plans.length - 3, "every entry of the company and the campaign under it, none of the other company");
    assert.deepEqual([...all.keys()].slice(0, 3), ["Young", "Reach only", "Hit"], "newest first");
    const hit = all.get("Hit")!;
    assert.deepEqual(hit.ages["24h"], { exposures: 4000, baseline: 1000, ratio: 4 }, "against the 20 before it at their 24 hours: both campaigns of the company, not the two older posts, the other company or today's totals");
    assert.deepEqual(hit.ages["1h"], { exposures: 300, baseline: 100, ratio: 3 });
    assert.deepEqual(hit.ages["7d"], { exposures: null, baseline: 4000, ratio: null }, "three days old: no number at seven days yet");
    assert.deepEqual([hit.verdict, hit.rates.share, hit.baselineShareRate, hit.exposures, hit.style], ["viral", 0.01, 0.01, 6000, "product-hero"]);
    const reach = all.get("Reach only")!;
    assert.deepEqual([reach.ages["24h"].ratio, reach.rates.share, reach.verdict, reach.style], [4, 0, "above", "none"], "four times the views and no shares is not viral; a creative without a style");
    const young = all.get("Young")!;
    assert.deepEqual([young.ages["1h"].ratio, young.ages["24h"].exposures, young.ages["24h"].ratio, young.verdict, young.exposures, young.style], [2.5, null, null, "unknown", 800, "none"], "five hours old: the first hour is known, 24 hours is not, and the 800 views of now are not passed off as that");
    assert.deepEqual(["Story 7", "Story 8", "Story 9"].map((t) => all.get(t)!.verdict), ["unknown", "unknown", "unknown"], "a channel with three posts has no baseline, whatever the other channel has");

    const onStory = await titled(company, now, { channel: "story" });
    assert.deepEqual([...onStory.keys()], ["Story 7", "Story 8", "Story 9"], "one channel");
    assert.deepEqual([...(await titled(company, now, { last: 2 })).keys()], ["Young", "Reach only"], "the last two");
    const asked = await titled(company, now, { entryIds: [ids.get("Story 8")!, ids.get("Hit")!, ids.get("Stranger 5")!] });
    assert.deepEqual([...asked.keys()], ["Hit", "Story 8"], "the entries asked for, newest first, and none of another company");
    assert.deepEqual(asked.get("Hit"), all.get("Hit"), "judged as it is among all: against the company, not against the entries asked for");
    const ofLaunch = await titled(launch);
    assert.equal(ofLaunch.size, 11, "asked for a campaign: its own entries");
    assert.deepEqual([ofLaunch.get("Hit")!.ages["24h"].ratio, ofLaunch.get("Hit")!.verdict], [4, "viral"], "still judged against the company, not against its own ten posts (median 1,500)");
    assert.deepEqual([...(await titled(stranger)).values()].map((v) => v.verdict), ["unknown", "unknown", "unknown"], "an account with three posts");

    const early = await titled(company, new Date(now.getTime() - 3 * DAY + 2 * HOUR));
    assert.deepEqual([...early.keys()].slice(0, 2), ["Hit", "Story 7"], "as of two hours after the hit: later posts had not reached anyone");
    assert.deepEqual([early.get("Hit")!.ages["1h"].ratio, early.get("Hit")!.ages["24h"].ratio, early.get("Hit")!.verdict, early.get("Hit")!.exposures], [3, null, "unknown", 300]);

    assert.deepEqual(await metrics.styles(company, now), [
      { style: "product-hero", entries: 1, medianRatio: 4, medianShareRate: 0.01, viral: 1 },
      // every other entry; 18 of them have enough posts before them for a ratio (0.5, 1 or 1.5, and the 4 of the reach-only post)
      { style: "none", entries: 27, medianRatio: 1, medianShareRate: 0.01, viral: 0 },
    ]);

    await core.settings.set(launch.id, "virality.viralRatio", 5);
    assert.equal((await titled(company)).get("Hit")!.verdict, "viral", "the ratio is the company's: a value on a campaign under it is not used");
    await core.settings.set(company.id, "virality.viralRatio", 5);
    assert.equal((await titled(launch)).get("Hit")!.verdict, "above", "a company that asks for five times the usual views");
  } finally {
    await purge(core, tag);
    await core.close();
  }
});
