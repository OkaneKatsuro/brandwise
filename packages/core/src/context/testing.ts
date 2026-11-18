// Test helpers: a network and a browser that exist only in the test, so that reading a site and taking a look are tested without
// either. Names have the addresses the test gives them, addresses serve what the test gives them, the browser shows the page
// the test gives it, and everything that was asked of them is kept to look at.
import http from "node:http";
import { isIP } from "node:net";
import type { RenderedPage, Sample } from "./look.ts";
import type { Net, Render } from "./research.ts";

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

/** An element as a browser computed it: dark text of the made-up company's font on white, shown on the first screen, unless said otherwise. */
export const element = (over: Partial<Sample> = {}): Sample =>
  ({ color: [20, 22, 26, 255], background: [0, 0, 0, 0], backdrop: [255, 255, 255, 255], fontFamily: '"Acme Sans", Helvetica, sans-serif', top: 400, shown: true, ...over });

/**
 * The page of a made-up company as a browser rendered it: a white body, a heading in another colour and font, a paragraph with
 * a link in it, and a header with a logo, a menu link and a filled "start" link.
 */
export const renderedPage = (over: Partial<RenderedPage> = {}): RenderedPage => ({
  url: "https://acme.example/",
  screenHeight: 900,
  html: element({ backdrop: null }),
  body: element({ background: [255, 255, 255, 255], backdrop: null }),
  paragraphs: [element()],
  headings: [{ ...element({ color: [11, 31, 68, 255], fontFamily: "Georgia, serif", top: 120 }), level: 1 }],
  actions: [
    { ...element({ top: 20 }), link: true, inHeader: true, inParagraph: false },
    { ...element({ color: [255, 255, 255, 255], background: [31, 111, 235, 255], top: 20 }), link: true, inHeader: true, inParagraph: false },
    { ...element({ color: [31, 111, 235, 255] }), link: true, inHeader: false, inParagraph: true },
  ],
  icons: ["https://acme.example/favicon.svg"],
  headerImage: { src: "https://acme.example/logo.png" },
  ogImage: "/og.png",
  ...over,
});

/** The start of a PNG file that says how large the picture is, which is all that is ever read of it here. */
function png(width: number, height: number): Uint8Array {
  const bytes = Buffer.alloc(33);
  Buffer.from("89504e470d0a1a0a0000000d49484452", "hex").copy(bytes);
  bytes.writeUInt32BE(width, 16);
  bytes.writeUInt32BE(height, 20);
  return bytes;
}

/**
 * A browser: it "renders" by handing back the page the test gives it (or failing as the test says), with a picture of the top
 * of it. Like a real one, it first asks its proxy for everything the page names (`fetches`, plain http addresses). `asked` is
 * every render it was asked for.
 */
export function pretendBrowser(shows: RenderedPage | Error, fetches: string[] = []) {
  const asked: Parameters<Render>[0][] = [];
  const render: Render = async (page) => {
    asked.push(page);
    for (const address of fetches) {
      await new Promise<void>((resolve, reject) => http.get({ host: "127.0.0.1", port: page.proxyPort, path: address }, (res) => res.resume().on("end", resolve)).on("error", reject));
    }
    if (shows instanceof Error) throw shows;
    return { png: png(1440, 1800), page: shows };
  };
  return { render, asked };
}
