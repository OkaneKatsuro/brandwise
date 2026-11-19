// Threads connector, pure: the token exchange and renewal, the container flow and the counts of published posts, on recorded
// response shapes (no network).
import assert from "node:assert/strict";
import { test } from "node:test";
import { campaignSlug } from "./email/domain/render.ts";
import { threads, threadsConnection, threadsMetrics, threadsOAuth, threadsStatus, THREADS_TOKEN_KEY, type ThreadsConnection } from "./connector-threads.ts";
import { PartialPullError, type EntryRef } from "./metrics/domain.ts";
import type { PublishInput, ScopedTokens } from "./publish.ts";

type Call = { method: string; url: URL; auth: string | null; body: unknown };
const entry = (over: Record<string, unknown> = {}) => ({ id: "e1", campaignId: "c1", title: "t", body: "Hello", link: "https://example.com", campaignName: "Spring Sale", ...over }) as PublishInput["entry"];
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
const image = { kind: "image", mime: "image/png", name: "a.png", bytes: 3, read: async () => new Uint8Array([1, 2, 3]), url: async () => "https://s3.example/a.png?sig" };
const app = { appId: "APP", appSecret: "SECRET" };
const NOW = new Date("2026-11-06T12:00:00Z");
const fresh: ThreadsConnection = { token: "LONG", userId: "178", expiresAt: "2027-01-04T12:00:00Z", refreshedAt: "2026-11-06T11:00:00Z" };

function fakeThreads(answer: (key: string, call: Call) => unknown) {
  const calls: Call[] = [];
  const fetchImpl = (async (input: URL | string, init: any) => {
    const url = new URL(String(input));
    const b = init?.body;
    const call: Call = { method: init?.method ?? "GET", url, auth: init?.headers?.authorization ?? null, body: b instanceof URLSearchParams ? Object.fromEntries(b) : null };
    calls.push(call);
    const r = answer(`${call.method} ${url.pathname}`, call);
    return r instanceof Response ? r : json(r);
  }) as unknown as typeof fetch;
  return { calls, fetchImpl };
}
const memoryTokens = (initial: ThreadsConnection | null): ScopedTokens & { saved: Record<string, string> } => {
  const saved: Record<string, string> = initial ? { [THREADS_TOKEN_KEY]: JSON.stringify(initial) } : {};
  return { saved, get: async (_c, key) => saved[key] ?? null, set: async (_c, key, value) => { saved[key] = value; } };
};
const utm = `utm_source=threads&utm_medium=social&utm_campaign=${campaignSlug("Spring Sale")}&utm_content=e1`;

test("a text post: container with the link as a card, status, publish, permalink", async () => {
  const t = fakeThreads((key) => {
    if (key === "POST /v1.0/178/threads") return { id: "c1" };
    if (key === "GET /v1.0/c1") return { status: "FINISHED" };
    if (key === "POST /v1.0/178/threads_publish") return { id: "m1" };
    if (key === "GET /v1.0/m1") return { permalink: "https://www.threads.com/@demoshop/post/ABC" };
    throw new Error(`unexpected ${key}`);
  });
  const c = threads({ ...app, tokens: memoryTokens(fresh), fetchImpl: t.fetchImpl, now: () => NOW });
  const r = await c.publish({ idempotencyKey: "k", entry: entry(), asset: null, target: { userId: "178", username: "demoshop" } });
  assert.deepEqual(r, { externalId: "m1", url: "https://www.threads.com/@demoshop/post/ABC" });
  const p = t.calls[0].url.searchParams;
  assert.equal(p.get("media_type"), "TEXT");
  assert.equal(p.get("text"), "Hello");
  assert.equal(p.get("link_attachment"), `https://example.com/?${utm}`);
  assert.equal(t.calls[0].auth, "Bearer LONG");
  assert.equal(t.calls[1].url.searchParams.get("fields"), "status,error_message");
  assert.equal(t.calls[2].url.searchParams.get("creation_id"), "c1");
  assert.ok(!t.calls.some((x) => x.url.search.includes("LONG")), "the token never travels in the URL");
});

test("an image post puts the link in the text, waits for processing and renews a day-old token first", async () => {
  let polls = 0;
  const t = fakeThreads((key) => {
    if (key === "GET /refresh_access_token") return { access_token: "LONG-2", expires_in: 5_184_000 };
    if (key === "POST /v1.0/178/threads") return { id: "c2" };
    if (key === "GET /v1.0/c2") return ++polls < 3 ? { status: "IN_PROGRESS" } : { status: "FINISHED" };
    if (key === "POST /v1.0/178/threads_publish") return { id: "m2" };
    if (key === "GET /v1.0/m2") return json({ error: { message: "nope" } }, 400);
    throw new Error(`unexpected ${key}`);
  });
  const tokens = memoryTokens({ ...fresh, refreshedAt: "2026-11-01T00:00:00Z" });
  const waited: number[] = [];
  const c = threads({ ...app, tokens, fetchImpl: t.fetchImpl, now: () => NOW, wait: async (ms) => { waited.push(ms); } });
  const r = await c.publish({ idempotencyKey: "k", entry: entry(), asset: image, target: { userId: "178" } });
  assert.deepEqual(r, { externalId: "m2", url: undefined });
  assert.equal(t.calls[0].url.searchParams.get("grant_type"), "th_refresh_token");
  const saved = JSON.parse(tokens.saved[THREADS_TOKEN_KEY]) as ThreadsConnection;
  assert.equal(saved.token, "LONG-2");
  assert.equal(saved.refreshedAt, NOW.toISOString());
  assert.equal(saved.expiresAt, new Date(NOW.getTime() + 5_184_000_000).toISOString());
  const p = t.calls[1].url.searchParams;
  assert.equal(p.get("media_type"), "IMAGE");
  assert.equal(p.get("image_url"), "https://s3.example/a.png?sig");
  assert.equal(p.get("text"), `Hello\n\nhttps://example.com/?${utm}`);
  assert.equal(p.get("link_attachment"), null);
  assert.equal(t.calls[1].auth, "Bearer LONG-2");
  assert.equal(waited.length, 2, "the first status check is immediate, then it waits");
});

test("refusals: no target, wrong media type, too long, an expired connection, a container Threads rejected", async () => {
  const t = fakeThreads((key) => (key === "POST /v1.0/178/threads" ? { id: "c3" } : { status: "ERROR", error_message: "INVALID_ASPEC_RATIO" }));
  const c = threads({ ...app, tokens: memoryTokens(fresh), fetchImpl: t.fetchImpl, now: () => NOW, wait: async () => {} });
  await assert.rejects(c.publish({ idempotencyKey: "k", entry: entry(), asset: null, target: null }), /No userId/);
  await assert.rejects(c.publish({ idempotencyKey: "k", entry: entry(), asset: { ...image, mime: "image/gif", name: "a.gif" }, target: { userId: "178" } }), /JPEG or PNG images and MP4 or MOV videos; a\.gif/);
  await assert.rejects(c.publish({ idempotencyKey: "k", entry: entry({ body: "x".repeat(501), link: null }), asset: null, target: { userId: "178" } }), /501 characters, Threads allows 500/);
  await assert.rejects(c.publish({ idempotencyKey: "k", entry: entry(), asset: image, target: { userId: "178" } }), /did not accept the post: INVALID_ASPEC_RATIO/);
  const expired = threads({ ...app, tokens: memoryTokens({ ...fresh, expiresAt: "2026-11-01T00:00:00Z" }), fetchImpl: t.fetchImpl, now: () => NOW });
  await assert.rejects(expired.publish({ idempotencyKey: "k", entry: entry(), asset: null, target: { userId: "178" } }), /expired on 2026-11-01 .*connect again/);
  const none = threads({ ...app, tokens: memoryTokens(null), fetchImpl: t.fetchImpl });
  await assert.rejects(none.publish({ idempotencyKey: "k", entry: entry(), asset: null, target: { userId: "178" } }), /no Threads account: a person runs bb brandwise threads connect/);
});

test("oauth: the sign-in address, the two-step exchange to a 60-day token, and status", async () => {
  const u = new URL(threadsOAuth(app).authorizeUrl("https://x.example/oauth/threads", "st8"));
  assert.equal(u.origin + u.pathname, "https://threads.com/oauth/authorize");
  assert.deepEqual(Object.fromEntries(u.searchParams), { client_id: "APP", redirect_uri: "https://x.example/oauth/threads", scope: "threads_basic,threads_content_publish,threads_manage_insights", response_type: "code", state: "st8" });

  const t = fakeThreads((key) => {
    if (key === "POST /oauth/access_token") return { access_token: "SHORT", token_type: "bearer", user_id: 17841405793187218 };
    if (key === "GET /access_token") return { access_token: "LONG", token_type: "bearer", expires_in: 5_183_944 };
    if (key === "GET /v1.0/me") return { id: "17841405793187218", username: "demoshop" };
    throw new Error(`unexpected ${key}`);
  });
  const c = await threadsOAuth(app, t.fetchImpl).exchange("the-code", "https://x.example/oauth/threads", NOW);
  assert.deepEqual(t.calls[0].body, { client_id: "APP", client_secret: "SECRET", code: "the-code", grant_type: "authorization_code", redirect_uri: "https://x.example/oauth/threads" });
  assert.deepEqual(Object.fromEntries(t.calls[1].url.searchParams), { grant_type: "th_exchange_token", client_secret: "SECRET", access_token: "SHORT" });
  assert.deepEqual(c, { token: "LONG", userId: "17841405793187218", expiresAt: new Date(NOW.getTime() + 5_183_944_000).toISOString(), refreshedAt: NOW.toISOString() });

  const s = await threadsStatus({ ...app, tokens: memoryTokens(c), fetchImpl: t.fetchImpl, now: () => NOW }, "c1", { userId: c.userId, username: "demoshop" });
  assert.equal(s.connected, true);
  assert.match(s.lines[0], /^@demoshop \(17841405793187218\): connected; .* ends in 59 days without one$/);
  assert.equal((await threadsConnection({ ...app, tokens: memoryTokens(c), fetchImpl: t.fetchImpl, now: () => NOW }, "c1")).token, "LONG", "a token younger than a day is not renewed");

  const bad = fakeThreads(() => json({ error_type: "OAuthException", code: 400, error_message: "Matching code was not found or was already used" }, 400));
  await assert.rejects(threadsOAuth(app, bad.fetchImpl).exchange("x", "https://x"), /oauth\/access_token: Matching code was not found/);
});

const published = (id: string, externalId: string | null): EntryRef => ({ id, campaignId: "c1", channel: "threads", externalId, externalUrl: null });
/** One metric of media insights as Threads answers it. */
const insight = (media: string, name: string, value: number) => ({ name, period: "lifetime", values: [{ value }], title: name, description: "", id: `${media}/insights/${name}/lifetime` });

test("metrics: the insights of each published post; reposts, quotes and shares together are how often it was passed on", async () => {
  const t = fakeThreads((key) => {
    if (key === "GET /v1.0/17890000000000001/insights") return { data: [insight("17890000000000001", "views", 900), insight("17890000000000001", "likes", 100), insight("17890000000000001", "replies", 10), insight("17890000000000001", "reposts", 4), insight("17890000000000001", "quotes", 1), insight("17890000000000001", "shares", 2)] };
    // views and shares are in development: Threads may leave them out
    if (key === "GET /v1.0/17890000000000002/insights") return { data: [insight("17890000000000002", "likes", 3), insight("17890000000000002", "replies", 0), insight("17890000000000002", "reposts", 0), insight("17890000000000002", "quotes", 0)] };
    if (key === "GET /v1.0/17890000000000003/insights") return { data: [] };
    if (key === "GET /v1.0/17890000000000004/insights") return json({ error: { message: "Unsupported get request. Object with ID '17890000000000004' does not exist", type: "THApiException", code: 100 } }, 400);
    throw new Error(`unexpected ${key}`);
  });
  const source = threadsMetrics(() => ({ ...app, tokens: memoryTokens(fresh), fetchImpl: t.fetchImpl, now: () => NOW }));
  assert.deepEqual([source.id, source.channels, source.measures], ["threads", ["threads"], ["exposures", "reactions", "comments", "shares"]]);

  const failed = await source.pull!([published("e1", "17890000000000001"), published("e2", "17890000000000002"), published("empty", "17890000000000003"), published("deleted", "17890000000000004"), published("by-hand", null)], NOW).then(() => null, (err) => err);
  assert.ok(failed instanceof PartialPullError, "a deleted post does not lose the numbers of the others");
  assert.deepEqual(failed.snapshots, [
    { entryId: "e1", values: { exposures: 900, reactions: 100, comments: 10, shares: 7 } },
    { entryId: "e2", values: { reactions: 3, comments: 0, shares: 0 } },
  ], "views Threads did not answer stay unknown; an answer without a number is no snapshot");
  assert.deepEqual(failed.errors, ["Threads GET /17890000000000004/insights: Unsupported get request. Object with ID '17890000000000004' does not exist (code 100) (1 entry not read)"]);
  const first = t.calls[0];
  assert.deepEqual([first.url.origin, first.url.searchParams.get("metric"), first.auth], ["https://graph.threads.com", "views,likes,replies,reposts,quotes,shares", "Bearer LONG"]);
});

test("metrics: a connection without the insights permission says how to mend it, once for all its posts; no app, no numbers", async () => {
  const t = fakeThreads(() => json({ error: { message: "Application does not have permission for this action", type: "THApiException", code: 10 } }, 403));
  const failed = await threadsMetrics(() => ({ ...app, tokens: memoryTokens(fresh), fetchImpl: t.fetchImpl, now: () => NOW })).pull!([published("e1", "17890000000000001"), published("e2", "17890000000000002")], NOW).then(() => null, (err) => err);
  assert.ok(failed instanceof PartialPullError);
  assert.equal(failed.errors.length, 2, "each post names its own request");
  assert.match(failed.errors[0], /Application does not have permission for this action \(code 10\): the connection may lack threads_manage_insights; add it to the Threads app and connect the account again \(docs\/channels\.md\) \(1 entry not read\)$/);
  assert.deepEqual(await threadsMetrics(() => null).pull!([published("e1", "17890000000000001")], NOW), []);
  const none = await threadsMetrics(() => ({ ...app, tokens: memoryTokens(null), fetchImpl: t.fetchImpl, now: () => NOW })).pull!([published("e1", "17890000000000001"), published("e2", "17890000000000002")], NOW).then(() => null, (err) => err);
  assert.deepEqual(none.errors, ["This campaign has no Threads account: a person runs bb brandwise threads connect --campaign <c> (docs/channels.md) (2 entries not read)"]);
});
