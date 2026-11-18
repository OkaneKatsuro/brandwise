// Reading a company's site, the part that does I/O (docs/context-styles-map.md, step 2). The address comes from a person or from
// text an agent read, so every request is fenced: http and https only, public addresses only and checked on the address that is
// actually connected to, redirects followed by hand through the same checks, robots.txt honoured, one time limit and one size
// limit per page, one request at a time. No browser: a page is plain HTML that is parsed, and nothing of it runs.
// The network is two functions that are handed in, so the fence is tested without one.
import { lookup as dnsLookup } from "node:dns/promises";
import http from "node:http";
import https from "node:https";
import type { LookupFunction } from "node:net";
import { NotPublic, publicOnly, type Resolve } from "../public-address.ts";
import {
  addressProblem, decodeHtml, DEFAULT_PAGES, headProblem, pagesProblem, readPage, redirectTarget, robotsAllow, robotsRules, siteLinks, USER_AGENT,
  type Head, type Page, type RobotsRule,
} from "./site.ts";

/** A page gets this long to answer, redirects included; a page larger than this is not read; a chain of redirects ends here. */
const PAGE_TIMEOUT_MS = 10_000;
const MAX_BYTES = 2_000_000;
const MAX_REDIRECTS = 5;

/** A reply: its head, and its body when the caller wanted it. `truncated`: the body was longer than allowed and reading stopped. */
type Reply = Head & { body: Uint8Array; truncated: boolean };

/** The network as the reader uses it. */
export type Net = {
  resolve: Resolve;
  /**
   * One GET, redirects not followed. A host name is resolved with `lookup` and the connection goes to what it hands back. The
   * body is read only when `wants` says so after the head, and only up to `maxBytes`. Rejects with an error named TimeoutError
   * when `timeoutMs` pass before the reply is complete.
   */
  request: (url: URL, opts: { lookup: LookupFunction; headers: Record<string, string>; timeoutMs: number; maxBytes: number; wants: (head: Head) => boolean }) => Promise<Reply>;
};

/** The real network: the system's resolver and `node:http` / `node:https`, a new connection for every request. */
export const nodeNet: Net = {
  resolve: (host) => dnsLookup(host, { all: true }),
  request: (url, opts) => {
    let timer: NodeJS.Timeout | undefined;
    return new Promise<Reply>((resolve, reject) => {
      const req = (url.protocol === "https:" ? https : http).request(url, { agent: false, lookup: opts.lookup, headers: opts.headers });
      timer = setTimeout(() => { reject(new DOMException("no answer in time", "TimeoutError")); req.destroy(); }, opts.timeoutMs);
      req.on("error", reject);
      req.on("response", (res) => {
        const head: Head = { status: res.statusCode ?? 0, contentType: res.headers["content-type"], contentEncoding: res.headers["content-encoding"], location: res.headers.location };
        const chunks: Buffer[] = [];
        let size = 0;
        const done = (truncated: boolean) => { resolve({ ...head, body: Buffer.concat(chunks), truncated }); res.destroy(); };
        if (!opts.wants(head)) return done(false);
        res.on("data", (chunk: Buffer) => {
          size += chunk.length;
          if (size > opts.maxBytes) done(true);
          else chunks.push(chunk);
        });
        res.on("end", () => done(false));
        res.on("error", reject);
      });
      req.end();
    }).finally(() => clearTimeout(timer));
  },
};

/** Why a request got no reply, as the end of a sentence about the address. */
const failure = (cause: unknown): string =>
  cause instanceof NotPublic ? cause.message
    : cause instanceof Error && cause.name === "TimeoutError" ? `no answer within ${PAGE_TIMEOUT_MS / 1000} s`
    : `cannot be reached (${(cause instanceof Error ? cause.message : String(cause)).slice(0, 200)})`;

/** What one read of a site gave: the pages read, the first being the one that was asked for, and the addresses it did not read. */
type SiteRead = { site: string; pages: Page[]; skipped: { url: string; reason: string }[] };

/**
 * Reads the page at `address` and the pages of the same site that its navigation, header and footer link to, at most `limit`
 * addresses in all. A page that cannot be read is skipped with the reason; when it is the page that was asked for, the read
 * fails with it. `site` is where that page lives, after its redirects.
 */
export async function readSite(net: Net, address: string, limit = DEFAULT_PAGES): Promise<SiteRead> {
  const tooMany = pagesProblem(limit);
  if (tooMany !== null) throw new Error(tooMany);
  let start: URL;
  try { start = new URL(address); } catch { throw new Error(`"${address}" is not an address: give the whole address of a page, like https://example.com`); }
  start.hash = "";
  const lookup = publicOnly(net.resolve);
  const robots = new Map<string, Promise<RobotsRule[] | string>>();

  /**
   * One GET with its redirects. Every hop passes the fence before it is requested: the address itself, the site it has to stay
   * on (`within`), that site's robots.txt (`robots`), and the name's addresses when the connection is made.
   */
  async function get(from: URL, fence: { robots: boolean; within?: string }, wants: (head: Head) => boolean): Promise<{ url: URL; reply: Reply } | { problem: string }> {
    let deadline: number | undefined;
    for (let url = from, hops = 0; ; hops++) {
      const refused = addressProblem(url)
        ?? (fence.within !== undefined && url.origin !== fence.within ? "it is on another site" : null)
        ?? (fence.robots ? await robotsProblem(url) : null);
      deadline ??= Date.now() + PAGE_TIMEOUT_MS; // the clock starts with the first request: reading a robots.txt before it has its own
      const reply = refused ?? await net.request(url, { lookup, wants, maxBytes: MAX_BYTES, timeoutMs: Math.max(1, deadline - Date.now()), headers: { "user-agent": USER_AGENT, "accept-encoding": "identity" } }).catch(failure);
      if (typeof reply === "string") return { problem: hops === 0 ? reply : `redirects to ${url.href.slice(0, 200)}: ${reply}` };
      const next = redirectTarget(reply, url);
      if (next === null) return { url, reply };
      if (hops === MAX_REDIRECTS) return { problem: `redirects more than ${MAX_REDIRECTS} times` };
      url = next;
    }
  }

  /**
   * Why the robots.txt of a site keeps us from `url`; null when it does not. Read once per site. A site without one (any 4xx)
   * allows everything; one whose robots.txt cannot be read is not read at all, as RFC 9309 asks.
   */
  async function robotsProblem(url: URL): Promise<string | null> {
    let rules = robots.get(url.origin);
    if (rules === undefined) {
      rules = get(new URL("/robots.txt", url.origin), { robots: false }, (head) => head.status === 200).then((got) => {
        if ("problem" in got) return `its robots.txt was not read: ${got.problem}`;
        if (got.reply.status === 200) return robotsRules(new TextDecoder().decode(got.reply.body));
        return got.reply.status >= 400 && got.reply.status < 500 ? [] : `its robots.txt answered HTTP ${got.reply.status}`;
      });
      robots.set(url.origin, rules);
    }
    const known = await rules;
    return typeof known === "string" ? known : robotsAllow(known, url.pathname + url.search) ? null : "robots.txt disallows it";
  }

  async function page(from: URL, within?: string): Promise<{ url: URL; html: string; page: Page } | { problem: string }> {
    const got = await get(from, { robots: true, within }, (head) => headProblem(head) === null);
    if ("problem" in got) return got;
    const problem = headProblem(got.reply) ?? (got.reply.truncated ? `larger than ${MAX_BYTES / 1_000_000} MB` : null);
    if (problem !== null) return { problem: got.url.href === from.href ? problem : `redirects to ${got.url.href}: ${problem}` };
    const html = decodeHtml(got.reply.body, got.reply.contentType);
    return { url: got.url, html, page: readPage(html, got.url) };
  }

  const first = await page(start);
  if ("problem" in first) throw new Error(`${start.href} was not read: ${first.problem}`);
  const site = first.url.origin, pages = [first.page], skipped: SiteRead["skipped"] = [], read = new Set([first.url.href]);
  for (const link of siteLinks(first.html, first.url).slice(0, limit - 1)) {
    const next = await page(new URL(link), site);
    if ("problem" in next) skipped.push({ url: link, reason: next.problem });
    else if (read.has(next.url.href)) skipped.push({ url: link, reason: `redirects to ${next.url.href}, which was already read` });
    else { read.add(next.url.href); pages.push(next.page); }
  }
  return { site, pages, skipped };
}
