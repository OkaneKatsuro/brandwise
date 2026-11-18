// The rules of the company map, without a database: which rows become which nodes, which links become edges, the order in a
// column, what a campaign says is left out, and the chain of a node.
import assert from "node:assert/strict";
import { test } from "node:test";
import type { Campaign } from "../index.ts";
import { chain, companyMap, type MapEdge, type MapParts } from "./domain.ts";

const campaign = (id: string, parentId: string | null, kind: Campaign["kind"] = "campaign"): Campaign => ({ id, parentId, rootId: "acme", name: id, kind, startsAt: null, endsAt: null });
const version = (name: string, v: number, confirmedAt: string | null) => ({ name, version: v, author: "cli", createdAt: "2026-11-01T10:00:00.000Z", confirmedAt, confirmedBy: confirmedAt && "cli:founder" });
const creative = (id: string, campaignId: string, style: string | null = null) => ({ id, campaignId, name: `${id}.png`, kind: "image", style, prompt: style && `A ${id} picture` });
const post = (id: string, campaignId: string, assetId: string | null, status: MapParts["posts"][number]["status"] = "published") => ({ id, campaignId, title: `Post ${id}`, channel: "telegram", status, scheduledAt: "2026-11-10T09:00:00.000Z", assetId });
const pairs = (edges: MapEdge[]) => edges.map((e) => `${e.from} -> ${e.to}`);

/** A company with nothing: no site read, no pack, no campaign under it, no creative, no post. */
const EMPTY: MapParts = {
  rootId: "acme", sources: [], pack: { files: [], missing: ["product.md", "audience.md", "claims.md", "constraints.md", "voice.md"] },
  campaigns: [campaign("acme", null, "always_on")], creatives: [], derived: [], posts: [], results: [], totals: [],
};

test("every link the data records is one edge, from where a thing came from to the thing", () => {
  const map = companyMap({
    ...EMPTY,
    sources: [{ kind: "site", site: "https://acme.example", readAt: "2026-11-02T08:00:00.000Z", pages: 7, notes: [] }],
    pack: { files: [version("product.md", 2, null), version("voice.md", 1, "2026-11-03T08:00:00.000Z")], missing: ["audience.md", "claims.md", "constraints.md"] },
    campaigns: [campaign("acme", null, "always_on"), campaign("launch", "acme")],
    creatives: [creative("teaser", "launch"), creative("hero", "launch", "product-hero"), creative("logo", "acme")],
    derived: [{ parentId: "hero", childId: "teaser" }],
    posts: [post("p3", "launch", "teaser", "pending_approval"), post("p2", "acme", null), post("p1", "launch", "hero")],
    results: [{ entryId: "p1", exposures: 4000, clicks: 80, verdict: "viral", ratio: 4 }],
    totals: [{ campaignId: "acme", creatives: 1, posts: 1 }, { campaignId: "launch", creatives: 2, posts: 2 }],
  });

  assert.equal(map.rootId, "acme");
  assert.deepEqual(map.nodes, [
    { id: "source:https://acme.example", column: "source", order: 0, site: "https://acme.example", readAt: "2026-11-02T08:00:00.000Z", pages: 7 },
    { id: "pack", column: "pack", order: 0, files: [{ name: "product.md", version: 2, confirmed: false }, { name: "voice.md", version: 1, confirmed: true }], missing: ["audience.md", "claims.md", "constraints.md"] },
    { id: "campaign:acme", column: "campaign", order: 0, campaignId: "acme", name: "acme", kind: "always_on", hidden: { creatives: 0, posts: 0 } },
    { id: "campaign:launch", column: "campaign", order: 1, campaignId: "launch", name: "launch", kind: "campaign", hidden: { creatives: 0, posts: 0 } },
    { id: "creative:teaser", column: "creative", order: 0, assetId: "teaser", campaignId: "launch", name: "teaser.png", kind: "image", style: null, prompt: null },
    { id: "creative:hero", column: "creative", order: 1, assetId: "hero", campaignId: "launch", name: "hero.png", kind: "image", style: "product-hero", prompt: "A hero picture" },
    { id: "creative:logo", column: "creative", order: 2, assetId: "logo", campaignId: "acme", name: "logo.png", kind: "image", style: null, prompt: null },
    { id: "post:p3", column: "post", order: 0, entryId: "p3", campaignId: "launch", title: "Post p3", channel: "telegram", status: "pending_approval", scheduledAt: "2026-11-10T09:00:00.000Z" },
    { id: "post:p2", column: "post", order: 1, entryId: "p2", campaignId: "acme", title: "Post p2", channel: "telegram", status: "published", scheduledAt: "2026-11-10T09:00:00.000Z" },
    { id: "post:p1", column: "post", order: 2, entryId: "p1", campaignId: "launch", title: "Post p1", channel: "telegram", status: "published", scheduledAt: "2026-11-10T09:00:00.000Z" },
    { id: "result:p1", column: "result", order: 0, entryId: "p1", exposures: 4000, clicks: 80, verdict: "viral", ratio: 4 },
  ]);
  assert.deepEqual(pairs(map.edges), [
    "source:https://acme.example -> pack",
    "pack -> campaign:acme",
    "campaign:acme -> campaign:launch",
    "campaign:launch -> creative:teaser",
    "campaign:launch -> creative:hero",
    "campaign:acme -> creative:logo",
    "creative:hero -> creative:teaser",
    "creative:teaser -> post:p3",
    "campaign:acme -> post:p2",
    "creative:hero -> post:p1",
    "post:p1 -> result:p1",
  ]);
});

test("a company with nothing still has its pack, which says what is missing and feeds nothing", () => {
  const map = companyMap(EMPTY);
  assert.deepEqual(map.nodes.map((n) => n.id), ["pack", "campaign:acme"]);
  assert.deepEqual(map.nodes[0], { id: "pack", column: "pack", order: 0, files: [], missing: EMPTY.pack.missing });
  assert.deepEqual(map.edges, [], "an empty pack is not linked to the company");
});

test("a site read for a pack that is not written yet leads to the empty pack", () => {
  const map = companyMap({ ...EMPTY, sources: [{ kind: "site", site: "https://acme.example", readAt: "2026-11-02T08:00:00.000Z", pages: 3, notes: [] }] });
  assert.deepEqual(pairs(map.edges), ["source:https://acme.example -> pack"]);
});

test("a post whose asset is not a creative on the map hangs on its own campaign", () => {
  const map = companyMap({ ...EMPTY, posts: [post("p1", "acme", "a-reference-page")] });
  assert.deepEqual(pairs(map.edges), ["campaign:acme -> post:p1"]);
});

test("a link to something the map does not show is left out", () => {
  const map = companyMap({
    ...EMPTY,
    creatives: [creative("crop", "acme")],
    derived: [{ parentId: "an-older-creative", childId: "crop" }],
    results: [{ entryId: "an-older-post", exposures: 10, clicks: 1, verdict: "unknown", ratio: null }],
  });
  assert.deepEqual(map.nodes.map((n) => n.id), ["pack", "campaign:acme", "creative:crop"], "a result without its post is not a node");
  assert.deepEqual(pairs(map.edges), ["campaign:acme -> creative:crop"]);
});

test("the company comes first in its column, each campaign followed by the campaigns under it", () => {
  const map = companyMap({ ...EMPTY, campaigns: [campaign("acme", null, "always_on"), campaign("spring", "acme"), campaign("autumn", "acme"), campaign("spring-week-1", "spring")] });
  assert.deepEqual(map.nodes.filter((n) => n.column === "campaign").map((n) => [n.id, n.order]), [["campaign:acme", 0], ["campaign:spring", 1], ["campaign:spring-week-1", 2], ["campaign:autumn", 3]]);
  assert.deepEqual(pairs(map.edges), ["campaign:acme -> campaign:spring", "campaign:acme -> campaign:autumn", "campaign:spring -> campaign:spring-week-1"]);
});

test("results stand in the order of their posts", () => {
  const result = (entryId: string) => ({ entryId, exposures: 100, clicks: null, verdict: "unknown" as const, ratio: null });
  const map = companyMap({ ...EMPTY, posts: [post("newest", "acme", null), post("unmeasured", "acme", null), post("oldest", "acme", null)], results: [result("oldest"), result("newest")] });
  assert.deepEqual(map.nodes.filter((n) => n.column === "result").map((n) => [n.id, n.order]), [["result:newest", 0], ["result:oldest", 1]]);
});

test("a campaign counts the creatives and posts of its own that the map leaves out", () => {
  const map = companyMap({
    ...EMPTY,
    campaigns: [campaign("acme", null, "always_on"), campaign("launch", "acme"), campaign("quiet", "acme"), campaign("busy", "acme")],
    creatives: [creative("hero", "launch")],
    posts: [post("p3", "busy", null), post("p2", "launch", "hero"), post("p1", "acme", null)],
    totals: [{ campaignId: "acme", creatives: 3, posts: 1 }, { campaignId: "launch", creatives: 1, posts: 38 }],
  });
  assert.deepEqual(map.nodes.flatMap((n) => (n.column === "campaign" ? [[n.name, n.hidden]] : [])), [
    ["acme", { creatives: 3, posts: 0 }],
    ["launch", { creatives: 0, posts: 37 }],
    ["quiet", { creatives: 0, posts: 0 }],
    ["busy", { creatives: 0, posts: 0 }],
  ], "a post that was added after the totals were counted is shown, and the count does not go below zero");
});

// source -> pack -> acme -> launch -> hero -> post -> result, and beside it acme -> logo and hero -> teaser
const NODES = ["source", "pack", "acme", "launch", "hero", "teaser", "logo", "post", "result"].map((id) => ({ id }));
const EDGES: MapEdge[] = [["source", "pack"], ["pack", "acme"], ["acme", "launch"], ["launch", "hero"], ["launch", "teaser"], ["hero", "teaser"], ["acme", "logo"], ["hero", "post"], ["post", "result"]].map(([from, to]) => ({ from, to }));

test("the chain of a node is everything it came from and everything that came from it, however many steps away", () => {
  assert.deepEqual(chain(NODES, EDGES, "post"), { upstream: ["source", "pack", "acme", "launch", "hero"], downstream: ["result"] }, "not the creatives beside its own");
  assert.deepEqual(chain(NODES, EDGES, "hero"), { upstream: ["source", "pack", "acme", "launch"], downstream: ["teaser", "post", "result"] });
  assert.deepEqual(chain(NODES, EDGES, "source"), { upstream: [], downstream: ["pack", "acme", "launch", "hero", "teaser", "logo", "post", "result"] }, "from a site, the whole company");
  assert.deepEqual(chain(NODES, EDGES, "logo"), { upstream: ["source", "pack", "acme"], downstream: [] }, "a creative no post uses ends its chain");
});

test("a node that is not on the map has no chain", () => {
  assert.deepEqual(chain(NODES, EDGES, "gone"), { upstream: [], downstream: [] });
});

test("links that run in a circle end the chain instead of running on", () => {
  const circle: MapEdge[] = [{ from: "a", to: "b" }, { from: "b", to: "c" }, { from: "c", to: "a" }];
  assert.deepEqual(chain([{ id: "a" }, { id: "b" }, { id: "c" }], circle, "a"), { upstream: ["b", "c"], downstream: ["b", "c"] });
});
