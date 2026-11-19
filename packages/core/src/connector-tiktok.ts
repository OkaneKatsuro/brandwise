// TikTok connector: Direct Post through the Content Posting API (https://developers.tiktok.com/doc/content-posting-api-get-started).
// The app's client key and secret are plugin settings; each campaign connects its creator account once (`bb brandwise tiktok connect`,
// docs/channels.md): the refresh token becomes a scoped secret setting (`tiktok.refreshToken`, inherited by child campaigns, never shown
// to agents) and the account the campaign's `tiktok` target (openId, username). Access tokens live two hours and are fetched per post;
// TikTok hands out a new refresh token on every refresh and voids the old one, so the newest is saved each time.
// A post is one video (MP4, MOV or WebM, up to 4 GB and 10 minutes) uploaded in chunks. Photos need a domain verified with TikTok
// (PULL_FROM_URL) and are not published. Until TikTok audits the app, every post is visible to the account only (SELF_ONLY).
import type { Connector, PublishInput, ScopedTokens } from "./publish.ts";
import { campaignSlug, tagText, withUtm } from "./email/domain/render.ts";
import { replaceUrls } from "./links/domain.ts";
import { counts, FETCH_TIMEOUT_MS, pullByCampaign, type EntryRef, type MetricsSource, type Snapshot } from "./metrics/domain.ts";

const API = "https://open.tiktokapis.com";
const AUTHORIZE = "https://www.tiktok.com/v2/auth/authorize/";
/** `video.publish` is Direct Post; `user.info.basic` lets the connection name the account; `video.list` reads the counts of its videos. */
export const TIKTOK_SCOPES = ["user.info.basic", "video.publish", "video.list"];
export const TIKTOK_TOKEN_KEY = "tiktok.refreshToken";
const TITLE_MAX = 2200;
const MB = 1_000_000;
/** TikTok's chunk rules: one chunk up to 64 MB; above that 5 to 64 MB chunks, the last one up to 128 MB (it takes the remainder). */
const SINGLE_CHUNK_MAX = 64 * MB, CHUNK = 32 * MB, FILE_MAX = 4_000 * MB;
const MIMES = new Set(["video/mp4", "video/quicktime", "video/webm"]);
/** status/fetch allows 30 calls a minute; two minutes of polling, then the post is recorded by its publish id and looked up later. */
const POLL = { everyMs: 5_000, attempts: 24 };

export type TikTokApp = { clientKey: string; clientSecret: string };
export type TikTokOptions = TikTokApp & {
  tokens: ScopedTokens;
  fetchImpl?: typeof fetch;
  /** Our short link for a link of the entry (docs/analytics.md, step 3); without it links stay as they are. */
  shorten?: (entryId: string, url: string) => Promise<string>;
  /** Sleep, replaced in tests. */
  wait?: (ms: number) => Promise<void>;
};
export type TikTokTokens = { access_token: string; expires_in: number; refresh_token: string; refresh_expires_in: number; open_id: string; scope: string };
export type CreatorInfo = {
  creator_username: string; creator_nickname: string; privacy_level_options: string[];
  comment_disabled: boolean; duet_disabled: boolean; stitch_disabled: boolean; max_video_post_duration_sec: number;
};
type Envelope = { error?: { code?: string; message?: string; log_id?: string } };

/** One call of the posting API: JSON in, JSON out; success is HTTP 200 with error.code "ok", anything else is an Error naming the call. */
function api(f: typeof fetch) {
  return async <T>(path: string, accessToken: string, body?: unknown, signal?: AbortSignal): Promise<T> => {
    const res = await f(`${API}${path}`, {
      method: "POST", headers: { authorization: `Bearer ${accessToken}`, "content-type": "application/json; charset=UTF-8" },
      body: body === undefined ? undefined : JSON.stringify(body), signal,
    });
    const json = (await res.json().catch(() => ({}))) as T & Envelope;
    const code = json.error?.code;
    if (!res.ok || (code !== undefined && code !== "ok")) throw new Error(`TikTok ${path.split("?")[0]}: ${json.error?.message ?? `HTTP ${res.status}`}${code && code !== "ok" ? ` (${code})` : ""}`);
    return json;
  };
}

/** The OAuth side: the address a person opens, the code exchange, the refresh (which returns a new refresh token every time). */
export function tiktokOAuth(app: TikTokApp, fetchImpl: typeof fetch = fetch) {
  const token = async (params: Record<string, string>): Promise<TikTokTokens> => {
    const res = await fetchImpl(`${API}/v2/oauth/token/`, {
      method: "POST", headers: { "content-type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ client_key: app.clientKey, client_secret: app.clientSecret, ...params }),
    });
    const json = (await res.json().catch(() => ({}))) as TikTokTokens & { error?: string; error_description?: string };
    if (!res.ok || !json.access_token) throw new Error(`TikTok oauth/token: ${json.error_description ?? json.error ?? `HTTP ${res.status}`}`);
    return json;
  };
  return {
    authorizeUrl(redirectUri: string, state: string): string {
      const u = new URL(AUTHORIZE);
      for (const [k, v] of Object.entries({ client_key: app.clientKey, scope: TIKTOK_SCOPES.join(","), response_type: "code", redirect_uri: redirectUri, state })) u.searchParams.set(k, v);
      return u.toString();
    },
    exchange: (code: string, redirectUri: string) => token({ code, grant_type: "authorization_code", redirect_uri: redirectUri }),
    refresh: (refreshToken: string) => token({ grant_type: "refresh_token", refresh_token: refreshToken }),
  };
}

export const creatorInfo = (fetchImpl: typeof fetch, accessToken: string) =>
  api(fetchImpl)<{ data: CreatorInfo }>("/v2/post/publish/creator_info/query/", accessToken).then((r) => r.data);

/** A fresh access token for the campaign's account; the rotated refresh token is saved where the old one was. */
export async function tiktokAccessToken(opts: TikTokOptions, campaignId: string): Promise<TikTokTokens> {
  const saved = await opts.tokens.get(campaignId, TIKTOK_TOKEN_KEY);
  if (!saved) throw new Error("This campaign has no TikTok account: a person runs bb brandwise tiktok connect --campaign <c> (docs/channels.md)");
  const t = await tiktokOAuth(opts, opts.fetchImpl ?? fetch).refresh(saved);
  if (t.refresh_token && t.refresh_token !== saved) await opts.tokens.set(campaignId, TIKTOK_TOKEN_KEY, t.refresh_token);
  return t;
}

/** How a file is cut for TikTok. */
export function chunkPlan(bytes: number): { size: number; count: number } {
  if (bytes <= SINGLE_CHUNK_MAX) return { size: bytes, count: 1 };
  return { size: CHUNK, count: Math.floor(bytes / CHUNK) };
}

/** The privacy of a post: the target's choice when the account allows it, else the most public level TikTok offers this account. */
export function privacyFor(wanted: string | undefined, options: string[]): string {
  if (wanted) {
    if (options.includes(wanted)) return wanted;
    const why = wanted === "PUBLIC_TO_EVERYONE" && !options.includes("PUBLIC_TO_EVERYONE") ? " (the app is not audited by TikTok yet, or the account is private)" : "";
    throw new Error(`TikTok does not allow privacy ${wanted} for this account; it allows ${options.join(", ")}${why}`);
  }
  return options.includes("PUBLIC_TO_EVERYONE") ? "PUBLIC_TO_EVERYONE" : options[0] ?? "SELF_ONLY";
}

export function tiktok(opts: TikTokOptions): Connector {
  const f = opts.fetchImpl ?? fetch;
  const call = api(f);
  const wait = opts.wait ?? ((ms) => new Promise<void>((r) => setTimeout(r, ms)));
  return {
    id: "tiktok",
    channels: ["tiktok"],
    targetHint: "bb brandwise tiktok connect --campaign <c>   (a person signs in to the creator account once; it becomes the campaign's tiktok target)",
    async publish({ entry, asset, target }) {
      if (!asset || asset.kind !== "video") throw new Error("A TikTok post is a video: attach one to the entry (photos need a domain verified with TikTok and are not published yet)");
      if (!MIMES.has(asset.mime)) throw new Error(`TikTok takes MP4, MOV or WebM; ${asset.name} is ${asset.mime}`);
      if (asset.bytes > FILE_MAX) throw new Error(`${asset.name} is over TikTok's 4 GB limit`);
      const utm = { entryId: entry.id, campaign: campaignSlug(entry.campaignName), medium: "social", source: "tiktok" };
      const short = (url: string) => (opts.shorten ? opts.shorten(entry.id, url) : Promise.resolve(url));
      const body = await replaceUrls(tagText(entry.body.trim(), utm), short);
      const link = entry.link ? await short(withUtm(entry.link, utm)) : null;
      const title = link && !body.includes(link) ? [body, link].filter(Boolean).join("\n\n") : body; // links in captions are text, so the short one goes in
      if (title.length > TITLE_MAX) throw new Error(`Caption is ${title.length} characters, TikTok allows ${TITLE_MAX}`);

      const { access_token: accessToken } = await tiktokAccessToken(opts, entry.campaignId);
      const creator = await creatorInfo(f, accessToken);
      const privacy = privacyFor(target?.privacy?.trim() || undefined, creator.privacy_level_options);
      const plan = chunkPlan(asset.bytes);
      const init = await call<{ data: { publish_id: string; upload_url: string } }>("/v2/post/publish/video/init/", accessToken, {
        post_info: { title, privacy_level: privacy, disable_duet: creator.duet_disabled, disable_comment: creator.comment_disabled, disable_stitch: creator.stitch_disabled },
        source_info: { source: "FILE_UPLOAD", video_size: asset.bytes, chunk_size: plan.size, total_chunk_count: plan.count },
      });
      const { publish_id: publishId, upload_url: uploadUrl } = init.data;
      // chunks go in order; the last one takes the remainder (206 = part taken, 201 = all parts taken)
      const bytes = await asset.read();
      let start = 0;
      for (let i = 0; i < plan.count; i++) {
        const end = i === plan.count - 1 ? asset.bytes : start + plan.size;
        const part = bytes.subarray(start, end);
        const res = await f(uploadUrl, { method: "PUT", headers: { "content-type": asset.mime, "content-length": String(part.byteLength), "content-range": `bytes ${start}-${end - 1}/${asset.bytes}` }, body: new Blob([part.slice()], { type: asset.mime }) });
        if (res.status !== 206 && res.status !== 201) throw new Error(`TikTok upload: HTTP ${res.status} on part ${i + 1} of ${plan.count}`);
        start = end;
      }
      // TikTok processes the upload; the public post id appears once moderation is through, which can take longer than we wait
      let status = "PROCESSING_UPLOAD", reason: string | undefined, postId: string | undefined;
      for (let i = 0; i < POLL.attempts && status !== "PUBLISH_COMPLETE" && status !== "FAILED"; i++) {
        await wait(POLL.everyMs);
        const s = (await call<{ data: { status: string; fail_reason?: string; publicaly_available_post_id?: (number | string)[] } }>("/v2/post/publish/status/fetch/", accessToken, { publish_id: publishId })).data;
        status = s.status; reason = s.fail_reason;
        if (s.publicaly_available_post_id?.length) postId = String(s.publicaly_available_post_id[0]);
      }
      if (status === "FAILED") throw new Error(`TikTok did not publish the video: ${reason ?? "no reason given"}`);
      // still processing: the post exists at TikTok, so it is recorded by its publish id rather than posted again
      return { externalId: postId ?? publishId, url: postId ? `https://www.tiktok.com/@${creator.creator_username}/video/${postId}` : undefined };
    },
  };
}

/** What the campaign's TikTok connection can do, for a person (`bb brandwise tiktok status`). */
export async function tiktokStatus(opts: TikTokOptions, campaignId: string, target: Record<string, string> | null): Promise<{ connected: boolean; creator: CreatorInfo | null; lines: string[] }> {
  if (!(await opts.tokens.get(campaignId, TIKTOK_TOKEN_KEY))) return { connected: false, creator: null, lines: ["No TikTok account connected to this campaign: bb brandwise tiktok connect --campaign <c>"] };
  const t = await tiktokAccessToken(opts, campaignId);
  const creator = await creatorInfo(opts.fetchImpl ?? fetch, t.access_token);
  const pub = creator.privacy_level_options.includes("PUBLIC_TO_EVERYONE");
  const lines = [
    `@${creator.creator_username} (${creator.creator_nickname}): connected, refresh token good for ${Math.floor(t.refresh_expires_in / 86400)} days`,
    `Posts may be ${creator.privacy_level_options.join(", ")}; videos up to ${creator.max_video_post_duration_sec} s`,
    ...(pub ? [] : ["Public posts are not possible: TikTok has not audited the app yet, or the account is private. Posts are visible to the account only."]),
    target ? `tiktok target: ${JSON.stringify(target)}` : "tiktok target: none (connect sets it; without it entries wait as Publish by hand)",
  ];
  return { connected: true, creator, lines };
}

/** video/query takes this many ids a request. */
const QUERY_CHUNK = 20;
/** The id of a video. A post TikTok was still processing when it was recorded has its publish id instead, which cannot be asked about. */
const VIDEO_ID = /^\d{5,25}$/;

/**
 * What TikTok counts for the videos this connector posted (video/query: https://developers.tiktok.com/doc/tiktok-api-v2-video-query),
 * with the `video.list` scope of the connection. A view is both the exposure and the video view of a video. TikTok answers for
 * videos of the connected account only; a video it leaves out (deleted, or another account's) gets no numbers. `app` is the
 * TikTok app as set at the moment of a pull; without one nothing is measured.
 */
export function tiktokMetrics(app: () => TikTokOptions | null): MetricsSource {
  /** One video/query for videos of one account. */
  const read = (opts: TikTokOptions) => async (accessToken: string, videos: EntryRef[]): Promise<Snapshot[]> => {
    const answer = await api(opts.fetchImpl ?? fetch)<{ data?: { videos?: { id: string; view_count?: number; like_count?: number; comment_count?: number; share_count?: number }[] } }>(
      "/v2/video/query/?fields=id,view_count,like_count,comment_count,share_count", accessToken, { filters: { video_ids: videos.map((v) => v.externalId) } }, AbortSignal.timeout(FETCH_TIMEOUT_MS),
    ).catch((err: Error) => { throw err.message.includes("scope_not_authorized") ? new Error(`${err.message}: the connection has no video.list scope; add it to the TikTok app and connect the account again (docs/channels.md)`) : err; });
    const counted = new Map((answer.data?.videos ?? []).map((v) => [v.id, v]));
    return videos.flatMap((v) => {
      const c = counted.get(v.externalId!);
      return c ? [{ entryId: v.id, values: counts({ exposures: c.view_count, video_views: c.view_count, reactions: c.like_count, comments: c.comment_count, shares: c.share_count }) }] : [];
    });
  };
  return {
    id: "tiktok",
    channels: ["tiktok"],
    measures: ["exposures", "video_views", "reactions", "comments", "shares"],
    async pull(entries) {
      const opts = app();
      if (opts === null) return [];
      return pullByCampaign(entries.filter((e) => VIDEO_ID.test(e.externalId ?? "")), { size: QUERY_CHUNK, account: async (campaignId) => (await tiktokAccessToken(opts, campaignId)).access_token, read: read(opts) });
    },
  };
}
