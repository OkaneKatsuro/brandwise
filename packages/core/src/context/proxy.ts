// The one way to the network for a browser that renders a stranger's page (docs/context-styles-map.md, step 3): a forward proxy
// on 127.0.0.1 that lives for one render. The page names what the browser fetches (styles, images, fonts, frames, redirects), so
// the fence of research.ts cannot stand around single requests: it stands around every connection the browser asks for. The
// proxy resolves the host itself, refuses what is not a public address or not a web port, and connects to the address it
// checked. A refusal is counted, not fatal: the page renders without that resource.
import http from "node:http";
import net, { type AddressInfo, type LookupFunction } from "node:net";
import type { Duplex } from "node:stream";
import { NotPublic, publicOnly, type Resolve } from "../public-address.ts";
import { addressProblem } from "./site.ts";

/** The ports of the web. Whatever else a public host listens on (mail, a database, an admin console) is no part of a page. */
const WEB_PORTS = [80, 443];
/** How many refused targets are named; the rest are only counted, so a page of ten thousand bad links gives a short report. */
const NAMED = 10;
/** Headers that belong to one connection, not to the request or reply behind it (RFC 9110, 7.6.1): they are not passed on. */
const HOP_BY_HOP = new Set(["connection", "keep-alive", "proxy-authenticate", "proxy-authorization", "proxy-connection", "te", "trailer", "transfer-encoding", "upgrade"]);

/** Opens a connection as `net.connect` does: a host name is resolved with `lookup` and the connection goes to what it hands back. */
export type Connect = (to: { host: string; port: number; lookup: LookupFunction }) => net.Socket;

/** What the proxy refused: how many connections, and the first targets (`host:port`), each once, with the reason. */
export type Refusals = { count: number; targets: { to: string; reason: string }[] };

type RenderProxy = {
  /** The port on 127.0.0.1 the browser is pointed at. */
  port: number;
  refused: () => Refusals;
  /** Stops listening and ends every connection that is still open, on both sides. */
  close: () => Promise<void>;
};

/** Where a request wants to go: the host without the brackets of an IPv6 address, and the port, given or the scheme's own. */
const targetOf = (url: URL) => ({ host: url.hostname.replace(/^\[|\]$/g, ""), port: Number(url.port) || (url.protocol === "https:" ? 443 : 80) });

const passedOn = (headers: http.IncomingHttpHeaders) => Object.fromEntries(Object.entries(headers).filter(([name]) => !HOP_BY_HOP.has(name)));

/**
 * Starts the proxy on a free port of 127.0.0.1. It speaks the two ways a browser asks a proxy: `CONNECT host:port` for a tunnel
 * (https) and a plain request with the whole address (http). `connect` is how a connection is opened; a test hands in its own.
 */
export async function startProxy(resolve: Resolve, connect: Connect = (to) => net.connect(to)): Promise<RenderProxy> {
  const lookup = publicOnly(resolve);
  const refused: Refusals = { count: 0, targets: [] };
  const open = new Set<Duplex>();
  const track = <S extends Duplex>(socket: S): S => {
    open.add(socket);
    socket.once("close", () => open.delete(socket));
    return socket;
  };

  /**
   * Why no connection is made to where `url` points; null when one is. A host name passes here and is judged when it is
   * resolved, by the lookup of the connection; an IP address is never resolved, so it is judged here.
   */
  const refusal = (url: URL): string | null => {
    const { port } = targetOf(url);
    return addressProblem(url) ?? (WEB_PORTS.includes(port) ? null : `port ${port} is not a web port (${WEB_PORTS.join(" or ")})`);
  };
  const refuse = (url: URL, reason: string) => {
    const { host, port } = targetOf(url), to = `${host.slice(0, 200)}:${port}`;
    refused.count++;
    if (refused.targets.length < NAMED && !refused.targets.some((t) => t.to === to)) refused.targets.push({ to, reason });
  };
  /** The connection to where `url` points, made through the lookup that lets only public addresses pass. */
  const dial = (url: URL) => track(connect({ ...targetOf(url), lookup }));
  /** A connection that failed: a name that is not public was refused, anything else is a host that cannot be reached. */
  const failed = (url: URL, cause: Error): 403 | 502 => {
    if (!(cause instanceof NotPublic)) return 502;
    refuse(url, cause.message);
    return 403;
  };

  const server = http.createServer();
  server.on("connection", track);
  server.on("clientError", (_cause, socket) => socket.destroy());

  // https: the browser asks for a tunnel and speaks TLS through it, so all the proxy ever sees is the host and the port
  server.on("connect", (req, client, head) => {
    // from here on the socket is ours alone, its errors included: a browser that hangs up on an answer is nobody's news
    client.on("error", () => client.destroy());
    const answer = (status: string) => client.end(`HTTP/1.1 ${status}\r\n\r\n`);
    let url: URL;
    try { url = new URL(`http://${req.url}`); } catch { return answer("400 Bad Request"); }
    const problem = refusal(url);
    if (problem !== null) {
      refuse(url, problem);
      return answer("403 Forbidden");
    }
    const upstream = dial(url);
    let joined = false;
    upstream.once("connect", () => {
      joined = true;
      client.write("HTTP/1.1 200 Connection Established\r\n\r\n");
      upstream.write(head);
      upstream.pipe(client);
      client.pipe(upstream);
    });
    upstream.on("error", (cause) => (joined ? client.destroy() : answer(failed(url, cause) === 403 ? "403 Forbidden" : "502 Bad Gateway")));
    client.on("close", () => upstream.destroy());
  });

  // http: the browser sends the request itself, with the whole address where a server gets a path
  server.on("request", (req, res) => {
    const answer = (status: number) => res.writeHead(status, { connection: "close" }).end();
    let url: URL;
    try { url = new URL(req.url ?? ""); } catch { return answer(400); }
    if (url.protocol !== "http:") return answer(400);
    const problem = refusal(url);
    if (problem !== null) {
      refuse(url, problem);
      return answer(403);
    }
    const upstream = http.request({ ...targetOf(url), method: req.method, path: `${url.pathname}${url.search}`, headers: passedOn(req.headers), createConnection: () => dial(url) });
    upstream.on("response", (reply) => {
      // a reply no server may repeat (a status under 100, a header that cannot be set) is the host's fault and never ours to throw
      try { res.writeHead(reply.statusCode ?? 502, passedOn(reply.headers)); } catch { return answer(502); }
      reply.on("error", () => res.destroy());
      reply.pipe(res);
    });
    upstream.on("error", (cause) => (res.headersSent ? res.destroy() : answer(failed(url, cause))));
    res.on("close", () => upstream.destroy());
    req.pipe(upstream);
  });

  await new Promise<void>((listening, failedToListen) => {
    server.once("error", failedToListen);
    server.listen(0, "127.0.0.1", listening);
  });
  return {
    port: (server.address() as AddressInfo).port,
    refused: () => ({ count: refused.count, targets: [...refused.targets] }),
    close: () => new Promise<void>((closed) => {
      server.close(() => closed());
      for (const socket of open) socket.destroy();
    }),
  };
}
