// Own short links: every link of a post points at our redirect, so each click is counted for the calendar entry it came from, in
// any channel, with nothing to set up on the client's side (docs/analytics.md, step 3). No database, no network: codes, signatures,
// bot detection, the client's address and the redirect's request limit.
import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import { isIPv4, isIPv6 } from "node:net";

const B62 = "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz";
const b62 = (bytes: Uint8Array) => [...bytes].map((b) => B62[b % 62]).join("");

/** A link id is random; the code that travels is `<id>.<signature>`, so only links we issued resolve and guessing is pointless. */
export const newLinkId = () => b62(randomBytes(8));
const sign = (key: string, id: string) => b62(createHmac("sha256", key).update(`link:${id}`).digest().subarray(0, 6));
export const codeOf = (key: string, id: string) => `${id}.${sign(key, id)}`;

/** The id of a code whose signature is ours, else null. */
export function verifyCode(key: string, code: string): string | null {
  const m = /^([0-9A-Za-z]{8})\.([0-9A-Za-z]{6})$/.exec(code);
  if (!m) return null;
  const want = Buffer.from(sign(key, m[1])), got = Buffer.from(m[2]);
  return want.length === got.length && timingSafeEqual(want, got) ? m[1] : null;
}

/**
 * Link previews and crawlers fetch a link without a person behind it (Telegram fetches every link of a post for its preview).
 * They are recorded but never counted as clicks.
 */
const BOTS = /bot\b|bot\/|crawler|spider|preview|facebookexternalhit|facebookcatalog|embedly|slackbot|discordbot|whatsapp|telegrambot|twitterbot|linkedinbot|skypeuripreview|pinterest|vkshare|googlebot|bingbot|yandex|applebot|duckduckbot|headless|curl\/|wget\/|python-requests|go-http-client|node-fetch|axios|^$/i;
export const isBot = (method: string, userAgent: string | null | undefined) => method.toUpperCase() === "HEAD" || BOTS.test((userAgent ?? "").trim());

/** A visitor is a salted hash of address and browser, so unique clicks can be counted without storing either. */
export const visitorOf = (key: string, ip: string | null, userAgent: string | null) =>
  createHmac("sha256", key).update(`visitor:${ip ?? ""}:${userAgent ?? ""}`).digest("hex").slice(0, 24);
/** The address alone, salted: one address adds at most MAX_VISITORS_PER_SOURCE visitors to an entry (a household, an office). */
export const sourceOf = (key: string, ip: string | null) => createHmac("sha256", key).update(`source:${ip ?? ""}`).digest("hex").slice(0, 24);
export const MAX_VISITORS_PER_SOURCE = 3;

/**
 * Where a request came from, as our own proxy saw it: the right-most X-Forwarded-For entry, which the proxy in front of the
 * instance appends. Entries left of it are whatever the client sent and are never trusted. An IPv6 address is cut to its /64: one
 * connection owns the whole /64 and may use any address in it, so the full address would be a new identity on every request (for
 * the visitor limit per address and for the redirect's request limit alike). Anything that is not an address is null.
 */
export function clientAddress(forwardedFor: string | null | undefined): string | null {
  const last = forwardedFor?.split(",").at(-1)?.trim() ?? "";
  const host = /^\[([^\]]+)\](?::\d+)?$/.exec(last)?.[1] ?? last.replace(/^(\d+\.\d+\.\d+\.\d+):\d+$/, "$1"); // "[v6]:port", "v4:port"
  const ip = host.replace(/%.*$/, "").replace(/^::ffff:(?=\d+\.\d+\.\d+\.\d+$)/i, ""); // zone id; IPv4 written as IPv6
  if (isIPv4(ip)) return ip;
  if (!isIPv6(ip)) return null;
  const [head, tail] = ip.split("::");
  const left = head ? head.split(":") : [], right = tail ? tail.split(":") : [];
  const groups = tail === undefined ? left : [...left, ...Array<string>(Math.max(8 - left.length - right.length, 0)).fill("0"), ...right];
  return `${groups.slice(0, 4).map((g) => g.toLowerCase().replace(/^0+(?=.)/, "")).join(":")}::/64`;
}

/** The redirect's request limit: per address and for all requests without one, each minute, over at most this many addresses. */
export const REDIRECT_LIMIT = { windowMs: 60_000, perKey: 120, shared: 600, maxKeys: 10_000 } as const;

/** What the redirect does with a request: send it on and record the click, send it on unrecorded, or refuse it. */
export type RedirectVerdict = "count" | "skip" | "refuse";

/**
 * The redirect's request limit, in fixed windows and with bounded memory: `verdict(address, now)` counts the request and says what
 * to do with it.
 * - An address is refused past `perKey` requests a window. Only that sender is affected.
 * - At most `maxKeys` addresses are followed at a time. Requests without an address, and new addresses while the table is full,
 *   are counted together; past `shared` they are sent on unrecorded and never refused, because real visitors are among them and a
 *   lost count beats a broken link. Sending from many addresses can therefore hide clicks for a window, but it cannot break links,
 *   fill the click table or grow this one.
 * In memory and per process, so a restart resets it; a plugin running in several processes needs a shared store.
 */
export function redirectLimiter(opts: { windowMs: number; perKey: number; shared: number; maxKeys: number }): (address: string | null, now: number) => RedirectVerdict {
  type Window = { n: number; reset: number };
  const followed = new Map<string, Window>();
  let shared: Window = { n: 0, reset: 0 }, sweepAt = 0;
  const count = (w: Window | undefined, now: number): Window => (w && w.reset > now ? { n: w.n + 1, reset: w.reset } : { n: 1, reset: now + opts.windowMs });
  return (address, now) => {
    if (now >= sweepAt) { // once a window, so a full table is not walked on every request
      for (const [k, w] of followed) if (w.reset <= now) followed.delete(k);
      sweepAt = now + opts.windowMs;
    }
    if (address !== null && (followed.has(address) || followed.size < opts.maxKeys)) {
      const w = count(followed.get(address), now);
      followed.set(address, w);
      return w.n > opts.perKey ? "refuse" : "count";
    }
    shared = count(shared, now);
    return shared.n > opts.shared ? "skip" : "count";
  };
}

/** Replace every http(s) URL of a text with what `fn` returns for it (sentence punctuation after a URL stays outside it). */
export async function replaceUrls(text: string, fn: (url: string) => Promise<string>): Promise<string> {
  const parts: (string | Promise<string>)[] = [];
  let last = 0;
  for (const m of text.matchAll(/https?:\/\/[^\s<>"')]+/g)) {
    const url = m[0].replace(/[.,;:!?]+$/, "");
    parts.push(text.slice(last, m.index), fn(url));
    last = m.index! + url.length;
  }
  parts.push(text.slice(last));
  return (await Promise.all(parts)).join("");
}
