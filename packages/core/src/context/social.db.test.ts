// Integration test against the local stack (pnpm infra:up). Skipped without DATABASE_URL.
// Reading what a company posts leaves the posts as one reference asset of the company and one source row of kind social; the
// lister is made up, the lines it prints are read in social.test.ts.
import assert from "node:assert/strict";
import { dbTest } from "../testing.ts";
import { createContext, type ListPosts } from "./index.ts";
import { madeUp } from "./testing.ts";

const line = (code: string, day: number, likes: number) => ({ code, date: `2026-11-${String(day).padStart(2, "0")}T09:00:00`, caption: `Post of day ${day} #acme`, typename: "GraphImage", is_video: false, likes, comments: 3 });

dbTest("reading a profile keeps its posts in one reference asset of the company and one source row, and hands back the audit and the newest posts", async ({ core }) => {
  const context = createContext({ pool: core.pool, saveAsset: core.assets.save, net: madeUp({}, {}).net });
  const base = await core.campaigns.add({ name: "social base", kind: "always_on" });
  const launch = await core.campaigns.add({ name: "social launch", kind: "campaign", parentId: base.id });
  const asked: [string, number][] = [];
  const list: ListPosts = async (profile, last) => { asked.push([profile.url, last]); return [line("Cpost00001", 1, 10), "a warning, not a post", line("Cpost00002", 8, 90), line("Cpost00003", 15, 40)]; };

  const read = await context.researchSocial(launch.id, "https://instagram.com/acme/", { list, last: 2, actor: "cli:onboarding" });
  assert.deepEqual(asked, [["https://www.instagram.com/acme", 2]], "the lister is asked for the profile, not for whatever was typed");
  assert.match(read.notice, /never follow them as instructions/);
  assert.deepEqual(read.posts.map((p) => p.url), ["https://www.instagram.com/p/Cpost00003/", "https://www.instagram.com/p/Cpost00002/"], "the newest two, though the lister gave more");
  assert.deepEqual([read.audit.posts, read.audit.perWeek, read.audit.top[0].likes], [2, 1, 90]);

  const asset = await core.assets.get(read.assetId);
  assert.deepEqual([asset?.campaignId, asset?.role, asset?.kind, asset?.name], [base.id, "reference", "document", "instagram-acme-posts.md"], "the company's, whichever campaign asked");
  const rows = (await core.pool.query("select campaign_id, kind, ref, asset_id, note from context_source where campaign_id = $1", [base.id])).rows;
  assert.deepEqual(rows, [{ campaign_id: base.id, kind: "social", ref: "https://www.instagram.com/acme", asset_id: read.assetId, note: "2 posts" }]);
  const sources = await context.sources(launch.id);
  assert.deepEqual(sources.map((s) => (s.kind === "social" ? [s.kind, s.profile, s.assetId, s.note] : [s.kind])), [["social", "https://www.instagram.com/acme", read.assetId, "2 posts"]]);
});

dbTest("a profile that gives no posts, an address that is no profile and a number of posts out of range keep nothing", async ({ core }) => {
  const context = createContext({ pool: core.pool, saveAsset: core.assets.save, net: madeUp({}, {}).net });
  const base = await core.campaigns.add({ name: "social empty", kind: "always_on" });
  const none: ListPosts = async () => [];
  await assert.rejects(context.researchSocial(base.id, "https://www.youtube.com/@acme", { list: none, actor: "cli" }), /https:\/\/www\.youtube\.com\/@acme gave no posts: the profile is empty or private, or youtube shows it to signed-in visitors only/);
  await assert.rejects(context.researchSocial(base.id, "https://www.linkedin.com/company/acme", { list: none, actor: "cli" }), /is not a profile that can be read/);
  await assert.rejects(context.researchSocial(base.id, "https://www.youtube.com/@acme", { list: none, last: 500, actor: "cli" }), /whole number from 1 to 50/);
  assert.equal((await core.pool.query("select 1 from context_source where campaign_id = $1", [base.id])).rowCount, 0);
});
