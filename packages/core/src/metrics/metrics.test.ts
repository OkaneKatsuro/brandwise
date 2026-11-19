import assert from "node:assert/strict";
import { test } from "node:test";
import { resendCapabilities } from "../email/adapters/resend.ts";
import { emailMetricsSource } from "../email/metrics-source.ts";
import type { CountableEvent, EmailStore, SendRecord } from "../email/domain/ports.ts";
import { counts, merge, PartialPullError, pullByCampaign, rate, type EntryRef } from "./domain.ts";

test("merge: one number per metric from the first source that has it, never added up; the start falls back only when no source can tell", () => {
  const m = merge("e1", "telegram", [
    { source: "links", snap: { entryId: "e1", values: { clicks: 40 } } },
    { source: "platform", snap: { entryId: "e1", startedAt: "2026-11-02T10:00:00.000Z", values: { clicks: 55, exposures: 2000 } } },
  ], "2026-11-02T09:00:00.000Z");
  assert.deepEqual(m.values, { clicks: 40, exposures: 2000 }, "the first source's clicks, not 95");
  assert.deepEqual(m.sources, { clicks: "links", exposures: "platform" });
  assert.equal(m.startedAt, "2026-11-02T10:00:00.000Z");
  assert.equal(merge("e", "x", [{ source: "s", snap: { entryId: "e", values: {} } }], "2026-11-01T00:00:00.000Z").startedAt, "2026-11-01T00:00:00.000Z", "no source knows: the publish time");
  assert.equal(merge("e", "x", [{ source: "s", snap: { entryId: "e", startedAt: null, values: {} } }], "2026-11-01T00:00:00.000Z").startedAt, null, "a source that says 'not yet' is believed");
  assert.equal(rate(m, "clicks"), 0.02);
  assert.equal(rate(m, "complaints"), null, "an unmeasured metric has no rate, not 0");
});

test("e-mail source: counts from events up to the moment asked; a number the provider cannot emit is missing, not 0 (D1)", async () => {
  const send = (provider: string, emits: SendRecord["capabilities"]["emits"]): SendRecord => ({ id: `s-${provider}`, entryId: "e1", provider, externalId: "x", capabilities: { emits, details: [], features: [] }, createdAt: "2026-11-01T08:00:00.000Z", sentAt: "2026-11-01T09:00:00.000Z" });
  const events: (CountableEvent & { at: string })[] = [
    { sendId: "s-resend", type: "sent", recipientHash: "a", detail: {}, at: "2026-11-01T09:00:00.000Z" },
    { sendId: "s-resend", type: "delivered", recipientHash: "a", detail: {}, at: "2026-11-01T09:01:00.000Z" },
    { sendId: "s-resend", type: "clicked", recipientHash: "a", detail: {}, at: "2026-11-01T12:00:00.000Z" },
  ];
  const store = {
    sends: async () => [send("resend", resendCapabilities.emits)],
    eventsFor: async (_ids: string[], opts?: { asOf?: string }) => events.filter((e) => !opts?.asOf || e.at <= opts.asOf),
  } as unknown as EmailStore;
  const src = emailMetricsSource(store);
  const [early] = await src.at!([{ id: "e1", campaignId: "c1", channel: "email", externalId: null, externalUrl: null }], new Date("2026-11-01T10:00:00.000Z"));
  const [late] = await src.at!([{ id: "e1", campaignId: "c1", channel: "email", externalId: null, externalUrl: null }], new Date("2026-11-02T10:00:00.000Z"));
  assert.deepEqual([early.values.clicks, late.values.clicks, late.values.exposures], [0, 1, 1]);
  assert.equal(late.startedAt, "2026-11-01T09:00:00.000Z");
  assert.equal(resendCapabilities.emits.includes("unsubscribed"), false, "precondition: Resend reports unsubscribes as contact events");
  assert.equal("unsubscribes" in late.values, false, "unknown, so the unsubscribe guard is not fooled by a zero");
  const [before] = await src.at!([{ id: "e1", campaignId: "c1", channel: "email", externalId: null, externalUrl: null }], new Date("2026-11-01T08:30:00.000Z"));
  assert.equal(before.startedAt, null, "asked before the send: not started yet");
});

test("counts: what a platform gave as a count is a number; what it left out or gave as anything else stays unknown", () => {
  assert.deepEqual(counts({ exposures: "1520", reactions: 87, comments: 0, shares: undefined, saves: null, video_views: "12.5", reach: -1, clicks: "many" }), { exposures: 1520, reactions: 87, comments: 0 });
});

test("pullByCampaign: an account per campaign, a request per chunk; what failed is reported once with the entries it left unread", async () => {
  const entry = (id: string, campaignId: string): EntryRef => ({ id, campaignId, channel: "x", externalId: id, externalUrl: null });
  const entries = [entry("a1", "a"), entry("a2", "a"), entry("a3", "a"), entry("b1", "b"), entry("b2", "b"), entry("c1", "c"), entry("c2", "c"), entry("c3", "c")];
  const opened: string[] = [], asked: string[][] = [];
  const pull = () => pullByCampaign(entries, {
    size: 2,
    account: async (campaignId) => { opened.push(campaignId); if (campaignId === "b") throw new Error("not connected"); return `token-${campaignId}`; },
    read: async (token, chunk) => {
      asked.push([token, ...chunk.map((e) => e.id)]);
      if (token === "token-c") throw new Error("refused");
      return chunk.map((e) => ({ entryId: e.id, values: { exposures: 1 } }));
    },
  });
  const failed = await pull().then(() => null, (err) => err);
  assert.ok(failed instanceof PartialPullError);
  assert.deepEqual(failed.snapshots.map((x) => x.entryId), ["a1", "a2", "a3"]);
  assert.deepEqual(failed.errors, ["not connected (2 entries not read)", "refused (3 entries not read)"], "the same refusal of two requests is one line");
  assert.deepEqual([opened, asked], [["a", "b", "c"], [["token-a", "a1", "a2"], ["token-a", "a3"], ["token-c", "c1", "c2"], ["token-c", "c3"]]], "an account is opened once for its campaign");
  assert.deepEqual(await pullByCampaign([], { size: 2, account: async () => 1, read: async () => [] }), []);
});
