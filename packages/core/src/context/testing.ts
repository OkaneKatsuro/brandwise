// Test helper: a network that exists only in the test, so that reading a site is tested without one. Names have the addresses
// the test gives them, addresses serve what the test gives them, and everything that was asked of the network is kept to look at.
import { isIP } from "node:net";
import type { Net } from "./research.ts";

/** What an address serves: a page of HTML unless said otherwise; 404 when the test names nothing for it. */
export type Served = { status?: number; type?: string; encoding?: string; location?: string; body?: string | Uint8Array; timesOut?: boolean };

/** An address every name of a made-up site can have: public, and never really asked. */
export const PUBLIC = "93.184.216.34";
export const nav = (...links: string[]) => `<nav>${links.map((href) => `<a href="${href}">${href}</a>`).join("")}</nav>`;
export const html = (title: string, body = ""): Served => ({ body: `<!doctype html><html><head><title>${title}</title></head><body>${body}</body></html>` });

/**
 * The network: `names` with their addresses, `routes` with what each address serves. `request` does what node:http does with a
 * `lookup`: a name goes through it and the connection is made to what it hands back; an IP address is used as it is.
 * `all`: ask the lookup for every address, as node does when it may try several, or for one.
 */
export function madeUp(names: Record<string, string[]>, routes: Record<string, Served>, all = false) {
  const seen = { requests: [] as string[], connections: [] as string[], bodies: [] as string[], headers: [] as Record<string, string>[], timeouts: [] as number[], atOnce: 0 };
  let open = 0;
  const net: Net = {
    resolve: async (host) => {
      if (!(host in names)) throw new Error(`getaddrinfo ENOTFOUND ${host}`);
      return names[host].map((address) => ({ address, family: isIP(address) }));
    },
    request: async (url, opts) => {
      seen.atOnce = Math.max(seen.atOnce, ++open);
      try {
        const host = url.hostname.replace(/^\[|\]$/g, "");
        seen.connections.push(isIP(host) ? host : await new Promise<string>((resolve, reject) =>
          opts.lookup(host, { all }, (err, address) => (err ? reject(err) : resolve(typeof address === "string" ? address : address[0].address)))));
        seen.requests.push(url.href);
        seen.headers.push(opts.headers);
        seen.timeouts.push(opts.timeoutMs);
        await new Promise((resolve) => setTimeout(resolve, 2));
        const served = routes[url.href] ?? { status: 404 };
        if (served.timesOut) throw new DOMException("no answer in time", "TimeoutError");
        const head = { status: served.status ?? 200, contentType: served.type ?? "text/html; charset=utf-8", contentEncoding: served.encoding, location: served.location };
        if (!opts.wants(head)) return { ...head, body: new Uint8Array(), truncated: false };
        seen.bodies.push(url.href);
        const bytes = Buffer.from(served.body ?? "");
        return { ...head, body: bytes.subarray(0, opts.maxBytes), truncated: bytes.length > opts.maxBytes };
      } finally {
        open--;
      }
    },
  };
  return { net, seen };
}
