// YouTube connector, pure: the OAuth refresh, the resumable upload and the counts of uploaded videos, on recorded response shapes
// (no network).
import assert from "node:assert/strict";
import { test } from "node:test";
import { campaignSlug } from "./email/domain/render.ts";
import { youtube, youtubeMetrics, youtubeOAuth, youtubeStatus, YOUTUBE_TOKEN_KEY } from "./connector-youtube.ts";
import { PartialPullError, type EntryRef } from "./metrics/domain.ts";
import type { PublishInput, ScopedTokens } from "./publish.ts";

type Call = { method: string; url: string; headers: Record<string, string>; body: unknown };
const entry = (over: Record<string, unknown> = {}) => ({ id: "e1", campaignId: "c1", title: "Fall drop", body: "Hello", link: "https://example.com", campaignName: "Spring Sale", ...over }) as PublishInput["entry"];
const json = (body: unknown, status = 200, headers: Record<string, string> = {}) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json", ...headers } });
const video = { kind: "video", mime: "video/mp4", name: "a.mp4", bytes: 3, read: async () => new Uint8Array([1, 2, 3]), url: async () => "https://s3.example/a.mp4" };

function fakeGoogle(answer: (key: string, call: Call) => unknown) {
  const calls: Call[] = [];
  const fetchImpl = (async (input: URL | string, init: any) => {
    const url = String(input);
    const b = init?.body;
    const body = b instanceof URLSearchParams ? Object.fromEntries(b) : typeof b === "string" ? JSON.parse(b) : b instanceof Blob ? `<${b.size} bytes>` : b ?? null;
    const call: Call = { method: init?.method ?? "GET", url, headers: init?.headers ?? {}, body };
    calls.push(call);
    const u = new URL(url);
    const r = answer(`${call.method} ${u.origin}${u.pathname}`, call);
    return r instanceof Response ? r : json(r);
  }) as unknown as typeof fetch;
  return { calls, fetchImpl };
}
const memoryTokens = (initial: string | null): ScopedTokens => {
  const saved: Record<string, string> = initial ? { [YOUTUBE_TOKEN_KEY]: initial } : {};
  return { get: async (_c, key) => saved[key] ?? null, set: async (_c, key, value) => { saved[key] = value; } };
};
const app = { clientId: "ID", clientSecret: "SECRET" };

test("a video is uploaded: refresh, a resumable session with the metadata, one PUT with the bytes", async () => {
  const g = fakeGoogle((key) => {
    if (key === "POST https://oauth2.googleapis.com/token") return { access_token: "ACCESS", expires_in: 3599 };
    if (key === "POST https://www.googleapis.com/upload/youtube/v3/videos") return new Response(null, { status: 200, headers: { location: "https://www.googleapis.com/upload/youtube/v3/videos?uploadType=resumable&upload_id=U1" } });
    if (key === "PUT https://www.googleapis.com/upload/youtube/v3/videos") return json({ id: "dQw4w9WgXcQ", snippet: {} }, 201);
    throw new Error(`unexpected ${key}`);
  });
  const c = youtube({ ...app, tokens: memoryTokens("REFRESH"), fetchImpl: g.fetchImpl });
  const r = await c.publish({ idempotencyKey: "k", entry: entry(), asset: video, target: { channelId: "UC1", title: "Demo", privacy: "unlisted" } });
  assert.deepEqual(r, { externalId: "dQw4w9WgXcQ", url: "https://www.youtube.com/watch?v=dQw4w9WgXcQ" });
  assert.deepEqual(g.calls[0].body, { client_id: "ID", client_secret: "SECRET", grant_type: "refresh_token", refresh_token: "REFRESH" });
  const init = g.calls[1];
  assert.equal(new URL(init.url).search, "?uploadType=resumable&part=snippet,status");
  assert.deepEqual(init.headers, { authorization: "Bearer ACCESS", "content-type": "application/json; charset=UTF-8", "x-upload-content-type": "video/mp4", "x-upload-content-length": "3" });
  assert.deepEqual(init.body, { snippet: { title: "Fall drop", description: `Hello\n\nhttps://example.com/?utm_source=youtube&utm_medium=social&utm_campaign=${campaignSlug("Spring Sale")}&utm_content=e1` }, status: { privacyStatus: "unlisted", selfDeclaredMadeForKids: false } });
  const put = g.calls[2];
  assert.match(put.url, /upload_id=U1$/);
  assert.deepEqual(put.headers, { "content-type": "video/mp4", "content-length": "3" });
  assert.equal(put.body, "<3 bytes>");
});

test("refusals and Google errors: no video, no title, title too long, bad privacy, no channel, quota", async () => {
  const g = fakeGoogle((key) => {
    if (key === "POST https://oauth2.googleapis.com/token") return { access_token: "ACCESS", expires_in: 3599 };
    if (key === "POST https://www.googleapis.com/upload/youtube/v3/videos") return json({ error: { code: 403, message: "The request cannot be completed because you have exceeded your quota.", errors: [{ reason: "quotaExceeded" }] } }, 403);
    throw new Error(`unexpected ${key}`);
  });
  const c = youtube({ ...app, tokens: memoryTokens("REFRESH"), fetchImpl: g.fetchImpl });
  await assert.rejects(c.publish({ idempotencyKey: "k", entry: entry(), asset: null, target: {} }), /is a video/);
  await assert.rejects(c.publish({ idempotencyKey: "k", entry: entry({ title: " " }), asset: video, target: {} }), /needs a title/);
  await assert.rejects(c.publish({ idempotencyKey: "k", entry: entry({ title: "x".repeat(101) }), asset: video, target: {} }), /101 characters, YouTube allows 100/);
  await assert.rejects(c.publish({ idempotencyKey: "k", entry: entry(), asset: video, target: { privacy: "secret" } }), /must be public, unlisted or private/);
  await assert.rejects(c.publish({ idempotencyKey: "k", entry: entry(), asset: video, target: {} }), /videos\.insert: The request cannot be completed.*\(quotaExceeded\)/);
  assert.equal(g.calls.length, 2, "nothing is called before the checks pass");
  const none = youtube({ ...app, tokens: memoryTokens(null), fetchImpl: g.fetchImpl });
  await assert.rejects(none.publish({ idempotencyKey: "k", entry: entry(), asset: video, target: {} }), /no YouTube channel: a person runs bb brandwise youtube connect/);
});

test("oauth: the sign-in address asks for a refresh token; the exchange and refresh are form posts; status names the channel", async () => {
  const u = new URL(youtubeOAuth(app).authorizeUrl("http://localhost:38896/api/v1/plugins/brandwise/http/oauth/youtube", "st8"));
  assert.equal(u.origin + u.pathname, "https://accounts.google.com/o/oauth2/v2/auth");
  const p = Object.fromEntries(u.searchParams);
  assert.equal(p.access_type, "offline");
  assert.equal(p.prompt, "consent");
  assert.equal(p.scope, "https://www.googleapis.com/auth/youtube.upload https://www.googleapis.com/auth/youtube.readonly");
  assert.equal(p.redirect_uri, "http://localhost:38896/api/v1/plugins/brandwise/http/oauth/youtube");
  assert.equal(p.state, "st8");

  const g = fakeGoogle((key) => {
    if (key === "POST https://oauth2.googleapis.com/token") return { access_token: "ACCESS", refresh_token: "REFRESH", expires_in: 3599 };
    if (key === "GET https://www.googleapis.com/youtube/v3/channels") return { items: [{ id: "UC1", snippet: { title: "Demo Shop", customUrl: "@demoshop" } }] };
    throw new Error(`unexpected ${key}`);
  });
  const t = await youtubeOAuth(app, g.fetchImpl).exchange("the-code", "http://localhost/cb");
  assert.equal(t.refresh_token, "REFRESH");
  assert.deepEqual(g.calls[0].body, { client_id: "ID", client_secret: "SECRET", code: "the-code", grant_type: "authorization_code", redirect_uri: "http://localhost/cb" });
  const s = await youtubeStatus({ ...app, tokens: memoryTokens("REFRESH"), fetchImpl: g.fetchImpl }, "c1", { channelId: "UC1", title: "Demo Shop" });
  assert.deepEqual(s.lines, ["Demo Shop (@demoshop), channel UC1: connected", 'youtube target: {"channelId":"UC1","title":"Demo Shop"} (privacy: public; add privacy=unlisted to the target to upload unlisted)']);
  assert.equal(new URL(g.calls[2].url).search, "?part=snippet&mine=true");

  const bad = fakeGoogle(() => json({ error: "invalid_grant", error_description: "Bad Request" }, 400));
  await assert.rejects(youtubeOAuth(app, bad.fetchImpl).refresh("old"), /oauth token: Bad Request/);
});

const published = (id: string, campaignId: string, externalId: string | null): EntryRef => ({ id, campaignId, channel: "youtube", externalId, externalUrl: null });
/** A channel per campaign: c1 and c2 are connected, any other campaign is not. */
const channels: ScopedTokens = { get: async (campaignId) => ({ c1: "REFRESH-1", c2: "REFRESH-2" })[campaignId] ?? null, set: async () => {} };

test("metrics: the counts of the uploaded videos, one request per campaign's channel; a count YouTube leaves out stays unknown", async () => {
  // videos.list?part=statistics as YouTube answers it: counts are strings, likeCount is absent when the channel hides likes,
  // a deleted video is not among the items
  const statistics: Record<string, Record<string, string>> = {
    dQw4w9WgXcQ: { viewCount: "1520", likeCount: "87", favoriteCount: "0", commentCount: "12" },
    "hidden-like": { viewCount: "40", favoriteCount: "0", commentCount: "0" },
    "other-chan1": { viewCount: "7", likeCount: "1", favoriteCount: "0", commentCount: "0" },
  };
  const g = fakeGoogle((key, call) => {
    if (key === "POST https://oauth2.googleapis.com/token") return { access_token: `ACCESS-${(call.body as Record<string, string>).refresh_token}`, expires_in: 3599 };
    if (key === "GET https://www.googleapis.com/youtube/v3/videos") {
      const ids = new URL(call.url).searchParams.get("id")!.split(",");
      return { kind: "youtube#videoListResponse", items: ids.filter((id) => id in statistics).map((id) => ({ kind: "youtube#video", id, statistics: statistics[id] })), pageInfo: { totalResults: ids.length, resultsPerPage: ids.length } };
    }
    throw new Error(`unexpected ${key}`);
  });
  const source = youtubeMetrics(() => ({ ...app, tokens: channels, fetchImpl: g.fetchImpl }));
  assert.deepEqual([source.id, source.channels, source.measures], ["youtube", ["youtube"], ["exposures", "video_views", "reactions", "comments"]]);

  const entries = [published("e1", "c1", "dQw4w9WgXcQ"), published("e2", "c1", "hidden-like"), published("e3", "c1", "deleted-vid"), published("by-hand", "c1", null), published("e4", "c2", "other-chan1"), published("e5", "c3", "no-channel1")];
  const pull = await source.pull!(entries, new Date()).then(() => null, (err) => err);
  assert.ok(pull instanceof PartialPullError, "one campaign without a channel does not lose the numbers of the others");
  assert.deepEqual(pull.snapshots, [
    { entryId: "e1", values: { exposures: 1520, video_views: 1520, reactions: 87, comments: 12 } },
    { entryId: "e2", values: { exposures: 40, video_views: 40, comments: 0 } },
    { entryId: "e4", values: { exposures: 7, video_views: 7, reactions: 1, comments: 0 } },
  ]);
  assert.deepEqual(pull.errors, ["This campaign has no YouTube channel: a person runs bb brandwise youtube connect --campaign <c> (docs/channels.md) (1 entry not read)"]);
  const asked = g.calls.filter((c) => c.url.includes("/youtube/v3/videos"));
  assert.deepEqual(asked.map((c) => [new URL(c.url).searchParams.get("part"), new URL(c.url).searchParams.get("id"), c.headers.authorization]), [["statistics", "dQw4w9WgXcQ,hidden-like,deleted-vid", "Bearer ACCESS-REFRESH-1"], ["statistics", "other-chan1", "Bearer ACCESS-REFRESH-2"]]);
});

test("metrics: what YouTube refuses is reported with how many entries it left unread", async () => {
  const g = fakeGoogle((key) => {
    if (key === "POST https://oauth2.googleapis.com/token") return { access_token: "ACCESS", expires_in: 3599 };
    return json({ error: { code: 403, message: "The request cannot be completed because you have exceeded your quota.", errors: [{ reason: "quotaExceeded" }] } }, 403);
  });
  const source = youtubeMetrics(() => ({ ...app, tokens: channels, fetchImpl: g.fetchImpl }));
  await assert.rejects(source.pull!([published("e1", "c1", "dQw4w9WgXcQ"), published("e2", "c1", "hidden-like")], new Date()), (err: unknown) => {
    assert.ok(err instanceof PartialPullError);
    assert.deepEqual([err.snapshots, err.errors], [[], ["YouTube videos.list: The request cannot be completed because you have exceeded your quota. (quotaExceeded) (2 entries not read)"]]);
    return true;
  });
  assert.deepEqual(await source.pull!([published("by-hand", "c1", null)], new Date()), [], "nothing to ask about, nothing asked");
  assert.deepEqual(await youtubeMetrics(() => null).pull!([published("e1", "c1", "dQw4w9WgXcQ")], new Date()), [], "no Google client set: nothing is measured");
});
