// Virality, pure: the rules of docs/analytics.md on numbers made up here. The reads behind them are in virality.db.test.ts.
import assert from "node:assert/strict";
import { test } from "node:test";
import type { EntryMetrics } from "./domain.ts";
import { byStyle, judge, type Age, type AgedEntry } from "./virality.ts";

const DAY = 86_400_000;
const T0 = Date.parse("2026-10-01T09:00:00Z");
type Numbers = Partial<Record<Age, EntryMetrics["values"]>>;

/** A post that reached its audience `day` days after T0, with its numbers at the ages it has reached. */
const post = (id: string, day: number, at: Numbers, channel = "instagram"): AgedEntry => {
  const startedAt = new Date(T0 + day * DAY).toISOString();
  return { entryId: id, channel, startedAt, at: Object.fromEntries(Object.entries(at).map(([age, values]) => [age, { entryId: id, channel, startedAt, values, sources: {} }])) };
};
/**
 * An account's earlier posts on days 0 to n - 1: at 24 hours half have 900 views and half 1,100 (median 1,000), all shared by 1 % of
 * the viewers; 100 views after the first hour; 5,000 after a week, which is also where they stand today.
 */
const history = (n = 20): AgedEntry[] => Array.from({ length: n }, (_, i) => {
  const views = i % 2 ? 1100 : 900;
  return post(`h${i}`, i, { "1h": { exposures: 100 }, "24h": { exposures: views, shares: views / 100 }, "7d": { exposures: 5000, shares: 50 } });
});
const verdict = (numbers: Numbers, pool = history(), viralRatio = 3) => judge(post("new", 30, numbers), pool, viralRatio).verdict;

test("viral: four times the median views of the 20 earlier posts at 24 hours, shared at least as often as they were", () => {
  const v = judge(post("new", 30, { "24h": { exposures: 4000, shares: 40 } }), history(), 3);
  assert.deepEqual(v.ages["24h"], { exposures: 4000, baseline: 1000, ratio: 4 });
  assert.deepEqual([v.rates.share, v.baselineShareRate], [0.01, 0.01]);
  assert.equal(v.verdict, "viral");
});

test("reach without shares does not count: four times the views with no shares, fewer than usual or an unknown number of them is above, not viral", () => {
  assert.equal(verdict({ "24h": { exposures: 4000, shares: 0 } }), "above", "no shares");
  assert.equal(verdict({ "24h": { exposures: 4000, shares: 39 } }), "above", "shared less often than the account's posts usually are");
  assert.equal(verdict({ "24h": { exposures: 4000 } }), "above", "shares not measured: unknown is not 'enough'");
  const unshared = history().map((h) => ({ ...h, at: { "24h": { ...h.at["24h"]!, values: { exposures: 1000 } } } }));
  assert.equal(verdict({ "24h": { exposures: 4000, shares: 40 } }, unshared), "above", "no earlier post reports shares: there is no usual rate to reach");
  const neverShared = history().map((h) => ({ ...h, at: { "24h": { ...h.at["24h"]!, values: { exposures: 1000, shares: 0 } } } }));
  assert.equal(verdict({ "24h": { exposures: 4000, shares: 0 } }, neverShared), "above", "an account whose posts are never shared: a post nobody shared did not spread either");
  assert.equal(verdict({ "24h": { exposures: 4000, shares: 1 } }, neverShared), "viral", "the first post of that account that is shared");
});

test("too little history is unknown: an account with three posts, and one whose earlier posts mostly lack the number", () => {
  const v = judge(post("new", 30, { "24h": { exposures: 4000, shares: 40 } }), history(3), 3);
  assert.deepEqual([v.verdict, v.ages["24h"].baseline, v.ages["24h"].ratio], ["unknown", null, null]);
  assert.equal(verdict({ "24h": { exposures: 4000, shares: 40 } }, history(4)), "unknown");
  assert.equal(verdict({ "24h": { exposures: 4000, shares: 40 } }, history(5)), "viral", "five earlier posts are a baseline");
  const unmeasured = history().map((h, i) => (i < 16 ? { ...h, at: {} } : h));
  assert.equal(verdict({ "24h": { exposures: 4000, shares: 40 } }, unmeasured), "unknown", "20 earlier posts, but only four have views at 24 hours");
});

test("unknown exposures are unknown, never a ratio of zero: views not measured, or the entry is younger than 24 hours", () => {
  const unmeasured = judge(post("new", 30, { "24h": { shares: 40 } }), history(), 3);
  assert.deepEqual([unmeasured.verdict, unmeasured.ages["24h"].ratio, unmeasured.rates.share], ["unknown", null, null]);
  const young = judge(post("new", 30, { "1h": { exposures: 300 } }), history(), 3);
  assert.deepEqual(young.ages["1h"], { exposures: 300, baseline: 100, ratio: 3 }, "the first hour is already comparable");
  assert.deepEqual([young.ages["24h"].exposures, young.ages["24h"].ratio, young.verdict], [null, null, "unknown"], "no number at an age it has not reached");
  const empty = history().map((h) => ({ ...h, at: { "24h": { ...h.at["24h"]!, values: { exposures: 0, shares: 0 } } } }));
  assert.equal(judge(post("new", 30, { "24h": { exposures: 4000, shares: 40 } }), empty, 3).ages["24h"].ratio, null, "a baseline of zero gives no ratio");
});

test("values are aligned by age: a number at 24 hours meets the earlier posts' numbers at their 24 hours, not where they stand today", () => {
  const v = judge(post("new", 30, { "1h": { exposures: 250 }, "24h": { exposures: 4000, shares: 40 } }), history(), 3);
  assert.equal(v.ages["1h"].ratio, 2.5, "against 100 views after their first hour");
  assert.equal(v.ages["24h"].ratio, 4, "against 1,000 views at their 24 hours, not the 5,000 they have by now (which would give 0.8)");
  assert.deepEqual(v.ages["7d"], { exposures: null, baseline: 5000, ratio: null });
  assert.equal(v.verdict, "viral");
});

test("the baseline is the previous 20 posts of the same channel: older posts, later posts, other channels and the entry itself stay out", () => {
  const entry = post("new", 30, { "24h": { exposures: 4000, shares: 40 } });
  const big = { "24h": { exposures: 100_000, shares: 1000 } };
  const pool = [
    ...Array.from({ length: 5 }, (_, i) => post(`old${i}`, -10 + i, big)),
    ...history(),
    ...Array.from({ length: 30 }, (_, i) => post(`tiktok${i}`, i, big, "tiktok")),
    post("later", 31, big),
    entry,
  ];
  assert.deepEqual(judge(entry, pool, 3).ages["24h"], { exposures: 4000, baseline: 1000, ratio: 4 });
});

test("the bands: above from 1.5 times the baseline, typical from 0.67, below under it; how far above is viral is the caller's ratio", () => {
  const at = (exposures: number) => ({ "24h": { exposures, shares: exposures / 100 } });
  assert.deepEqual([1500, 1499, 670, 669].map((n) => verdict(at(n))), ["above", "typical", "typical", "below"]);
  assert.deepEqual([3000, 2999].map((n) => verdict(at(n))), ["viral", "above"], "viral from the ratio itself");
  assert.equal(verdict(at(4000), history(), 5), "above", "a company that asks for five times is not satisfied by four");
});

test("rates: share, save and engagement over exposures; an unknown part makes a rate unknown, never smaller", () => {
  const rates = (values: EntryMetrics["values"]) => judge(post("new", 30, { "24h": values }), history(), 3).rates;
  assert.deepEqual(rates({ exposures: 1024, shares: 16, saves: 8, reactions: 128, comments: 32 }), { share: 16 / 1024, save: 8 / 1024, engagement: 184 / 1024 });
  assert.deepEqual(rates({ exposures: 1024, shares: 16, reactions: 128, comments: 32 }), { share: 16 / 1024, save: null, engagement: null }, "a platform without saves has no engagement rate, not a lower one");
  assert.deepEqual(rates({ shares: 16, saves: 8, reactions: 128, comments: 32 }), { share: null, save: null, engagement: null }, "no views, no rate");
});

test("by style: its entries, the median ratio and share rate of those that have one, how many went viral; the best ratio first, unknown last", () => {
  const row = (style: string, ratio: number | null, share: number | null, v: "viral" | "above" | "typical" | "below" | "unknown") => ({
    style, verdict: v, rates: { share, save: null, engagement: null },
    ages: { "1h": { exposures: null, baseline: null, ratio: null }, "24h": { exposures: null, baseline: null, ratio }, "7d": { exposures: null, baseline: null, ratio: null } },
  });
  const styles = byStyle([
    row("none", 0.5, 0.004, "below"),
    row("product-hero", 4, 0.02, "viral"), row("product-hero", 1, 0.01, "typical"), row("product-hero", 3.5, 0.03, "viral"), row("product-hero", null, null, "unknown"),
    row("meme", null, null, "unknown"),
    row("customer-quote", 2, null, "above"), row("customer-quote", 1, 0.01, "typical"),
  ]);
  assert.deepEqual(styles, [
    { style: "product-hero", entries: 4, medianRatio: 3.5, medianShareRate: 0.02, viral: 2 },
    { style: "customer-quote", entries: 2, medianRatio: 1.5, medianShareRate: 0.01, viral: 0 },
    { style: "none", entries: 1, medianRatio: 0.5, medianShareRate: 0.004, viral: 0 },
    { style: "meme", entries: 1, medianRatio: null, medianShareRate: null, viral: 0 },
  ]);
});
