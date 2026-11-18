// The proxy a rendering browser is held to, tried with real sockets on this machine: a client that asks as a browser does (a
// tunnel for https, a plain request for http), a server that stands for a public site, and a resolver the test makes up.
import assert from "node:assert/strict";
import http from "node:http";
import net, { isIP, type AddressInfo } from "node:net";
import { test, type TestContext } from "node:test";
import { nodeNet } from "./research.ts";
import { startProxy, type Connect } from "./proxy.ts";
import { PUBLIC } from "./testing.ts";

const HERE = { address: "127.0.0.1", family: 4 };

/** A server on this machine that stands for a public site: it answers every request with what it was asked, and counts its connections. */
async function site(t: TestContext) {
  const seen = { connections: 0 };
  const server = http.createServer((req, res) => {
    let body = "";
    req.on("data", (chunk) => (body += chunk));
    req.on("end", () => res.writeHead(200, { "content-type": "application/json", "x-site": "acme" }).end(JSON.stringify({ method: req.method, url: req.url, headers: req.headers, body })));
  });
  server.on("connection", () => seen.connections++);
  await new Promise<void>((resolve) => server.listen(0, HERE.address, resolve));
  t.after(() => { server.closeAllConnections(); server.close(); });
  return { seen, port: (server.address() as AddressInfo).port };
}

/**
 * Opens the proxy's connections in a test. A name still goes through the proxy's lookup, as in `net.connect`, and an address
 * is used as it is; but the connection lands on `port` of this machine, where the test's server listens. `dialled` is where
 * each would have gone.
 */
function landingOn(port: number) {
  const dialled: string[] = [];
  const connect: Connect = (to) => {
    if (isIP(to.host) !== 0) {
      dialled.push(`${to.host}:${to.port}`);
      return net.connect(port, HERE.address);
    }
    return net.connect({
      host: to.host, port,
      lookup: (host, options, done) => to.lookup(host, options, (err, checked) => {
        if (err) return done(err, []);
        dialled.push(`${typeof checked === "string" ? checked : checked.map((a) => a.address).join("+")}:${to.port}`);
        return options.all ? done(null, [HERE]) : done(null, HERE.address, HERE.family);
      }),
    });
  };
  return { connect, dialled };
}

/** The made-up names of these tests and what they resolve to. */
const NAMES: Record<string, string[]> = {
  "acme.example": [PUBLIC], "intranet.example": ["10.0.0.5"], "both.example": [PUBLIC, "192.168.1.1"], "metadata.example": ["169.254.169.254"], "home.example": ["127.0.0.1"], "six.example": ["::1"],
};
const resolver = (names = NAMES) => {
  const asked: string[] = [];
  const resolve = async (host: string) => {
    asked.push(host);
    if (!(host in names)) throw new Error(`getaddrinfo ENOTFOUND ${host}`);
    return names[host].map((address) => ({ address, family: isIP(address) }));
  };
  return { resolve, asked };
};

async function proxyTo(t: TestContext, port: number, names = NAMES) {
  const { connect, dialled } = landingOn(port), { resolve, asked } = resolver(names);
  const proxy = await startProxy(resolve, connect);
  t.after(() => proxy.close());
  return { proxy, dialled, asked };
}

/** Asks the proxy for a tunnel, as a browser does for https: the status it answers with, and the socket the tunnel then runs on. */
const tunnel = (proxyPort: number, target: string) => new Promise<{ status: number; socket: net.Socket }>((resolve, reject) => {
  const req = http.request({ host: HERE.address, port: proxyPort, method: "CONNECT", path: target });
  req.on("connect", (res, socket) => resolve({ status: res.statusCode ?? 0, socket }));
  req.on("error", reject);
  req.end();
});

/** One request, and the reply with its body. `over` sends it on a socket that is already there (a tunnel). */
const ask = (options: http.RequestOptions, body?: string, over?: net.Socket) => new Promise<{ status: number; headers: http.IncomingHttpHeaders; body: string }>((resolve, reject) => {
  const req = http.request({ ...options, ...(over ? { createConnection: () => over } : {}) }, (res) => {
    let text = "";
    res.on("data", (chunk) => (text += chunk));
    res.on("end", () => resolve({ status: res.statusCode ?? 0, headers: res.headers, body: text }));
  });
  req.on("error", reject);
  req.end(body);
});
/** A plain request through the proxy, as a browser sends it for http: the whole address where a server gets a path. */
const plain = (proxyPort: number, address: string, extra: http.RequestOptions = {}, body?: string) =>
  ask({ host: HERE.address, port: proxyPort, path: address, ...extra, headers: { host: new URL(address).host, ...extra.headers } }, body);

test("https: a tunnel to a public name is opened to the address the name was checked at, and carries the browser's bytes both ways", async (t) => {
  const acme = await site(t);
  const { proxy, dialled } = await proxyTo(t, acme.port);
  const { status, socket } = await tunnel(proxy.port, "acme.example:443");
  assert.equal(status, 200);
  const reply = await ask({ path: "/pricing?plan=solo", headers: { host: "acme.example", connection: "close" } }, undefined, socket);
  assert.deepEqual([reply.status, JSON.parse(reply.body).url, JSON.parse(reply.body).headers.host], [200, "/pricing?plan=solo", "acme.example"], "what goes through the tunnel reaches the site untouched");
  assert.deepEqual(dialled, [`${PUBLIC}:443`]);
  assert.deepEqual(proxy.refused(), { count: 0, targets: [] });

  const byAddress = await tunnel(proxy.port, `${PUBLIC}:443`);
  assert.equal(byAddress.status, 200, "a public address needs no name");
  byAddress.socket.destroy();
});

test("http: a plain request for a public name is passed on with its method, path, headers and body, and the reply is handed back", async (t) => {
  const acme = await site(t);
  const { proxy, dialled } = await proxyTo(t, acme.port);
  const reply = await plain(proxy.port, "http://acme.example/styles/main.css?v=3", { headers: { accept: "text/css", "proxy-connection": "keep-alive", "proxy-authorization": "Basic c2VjcmV0" } });
  const asked = JSON.parse(reply.body);
  assert.deepEqual([reply.status, reply.headers["x-site"], asked.method, asked.url, asked.headers.host, asked.headers.accept], [200, "acme", "GET", "/styles/main.css?v=3", "acme.example", "text/css"]);
  assert.deepEqual([asked.headers["proxy-connection"], asked.headers["proxy-authorization"]], [undefined, undefined], "what was said to the proxy stays with the proxy");

  const posted = JSON.parse((await plain(proxy.port, "http://acme.example:80/report", { method: "POST", headers: { "content-type": "text/plain" } }, "seen")).body);
  assert.deepEqual([posted.method, posted.url, posted.body], ["POST", "/report", "seen"]);
  assert.deepEqual(dialled, [`${PUBLIC}:80`, `${PUBLIC}:80`]);
});

test("an address that is not public, a name that resolves to one and a port that is not 80 or 443 are refused, as a tunnel and as a plain request: each is counted and none gets a connection", async (t) => {
  const acme = await site(t);
  const { proxy, dialled } = await proxyTo(t, acme.port);
  const refusedTunnels = ["10.0.0.5:443", "127.0.0.1:443", "[::1]:443", "169.254.169.254:80", "intranet.example:443", "both.example:443", "metadata.example:80", "home.example:443", "six.example:443", "acme.example:8443", `${PUBLIC}:22`, `acme.example:${acme.port}`];
  for (const target of refusedTunnels) {
    const { status, socket } = await tunnel(proxy.port, target);
    assert.equal(status, 403, target);
    socket.destroy();
  }
  const refusedPlain = [`http://127.0.0.1:${acme.port}/`, "http://10.0.0.5/", "http://[::1]/", "http://intranet.example/", "http://home.example/admin", "http://acme.example:8080/"];
  for (const address of refusedPlain) assert.equal((await plain(proxy.port, address)).status, 403, address);

  assert.equal(acme.seen.connections, 0, "nothing reached the server");
  assert.deepEqual(dialled, []);
  const refused = proxy.refused();
  assert.equal(refused.count, refusedTunnels.length + refusedPlain.length);
  const reason = Object.fromEntries(refused.targets.map((r) => [r.to, r.reason]));
  assert.equal(reason["10.0.0.5:443"], "10.0.0.5 is not a public address");
  assert.equal(reason["::1:443"], "::1 is not a public address");
  assert.equal(reason["intranet.example:443"], "intranet.example resolves to 10.0.0.5, which is not a public address");
  assert.equal(reason["both.example:443"], "both.example resolves to 192.168.1.1, which is not a public address", "one answer that is not public is enough");
  assert.equal(reason["metadata.example:80"], "metadata.example resolves to 169.254.169.254, which is not a public address");
  assert.equal(reason["acme.example:8443"], "port 8443 is not a web port (80 or 443)");
});

test("a name is resolved once for a connection, and what was checked is what is dialled: a name that answers differently the next time gains nothing", async (t) => {
  const acme = await site(t);
  const answers = [[PUBLIC], ["127.0.0.1"]];
  const asked: string[] = [];
  const { connect, dialled } = landingOn(acme.port);
  const proxy = await startProxy(async (host) => {
    asked.push(host);
    return answers[asked.length - 1].map((address) => ({ address, family: 4 }));
  }, connect);
  t.after(() => proxy.close());

  assert.equal((await plain(proxy.port, "http://rebound.example/")).status, 200);
  assert.deepEqual([asked, dialled], [["rebound.example"], [`${PUBLIC}:80`]], "one question, and the connection went to its answer");
  assert.equal((await plain(proxy.port, "http://rebound.example/")).status, 403);
  assert.deepEqual([asked.length, dialled.length, acme.seen.connections], [2, 1, 1], "asked again for the next connection, and refused");
  assert.deepEqual(proxy.refused(), { count: 1, targets: [{ to: "rebound.example:80", reason: "rebound.example resolves to 127.0.0.1, which is not a public address" }] });
});

test("a host that cannot be found or reached is a failed connection, not a refusal", async (t) => {
  const { proxy } = await proxyTo(t, 1); // nothing listens on port 1 of this machine
  const { status, socket } = await tunnel(proxy.port, "acme.example:443");
  socket.destroy();
  assert.deepEqual([status, (await plain(proxy.port, "http://acme.example/")).status], [502, 502], "the site is down");
  assert.deepEqual([(await tunnel(proxy.port, "nowhere.example:443")).status, (await plain(proxy.port, "http://nowhere.example/")).status], [502, 502], "the name does not exist");
  assert.deepEqual(proxy.refused(), { count: 0, targets: [] });
});

test("a host that answers what no server may repeat, and a browser that hangs up on a refusal, are failures of theirs: the proxy goes on", async (t) => {
  const broken = net.createServer((socket) => socket.once("data", () => socket.end("HTTP/1.1 000 Nothing\r\ncontent-length: 0\r\n\r\n")));
  await new Promise<void>((resolve) => broken.listen(0, HERE.address, resolve));
  t.after(() => broken.close());
  const { proxy } = await proxyTo(t, (broken.address() as AddressInfo).port);
  assert.equal((await plain(proxy.port, "http://acme.example/")).status, 502, "a status under 100 is not passed on");

  // the browser takes the refusal of a tunnel and resets the connection: what it leaves on the proxy's end is an error of that socket
  await new Promise<void>((resolve) => {
    const browser = net.connect(proxy.port, HERE.address, () => browser.write("CONNECT 10.0.0.5:443 HTTP/1.1\r\n\r\n"));
    browser.once("data", () => { browser.resetAndDestroy(); resolve(); });
  });
  await new Promise((resolve) => setTimeout(resolve, 50));
  assert.equal((await plain(proxy.port, "http://acme.example/")).status, 502, "and the proxy still answers");
  assert.equal(proxy.refused().count, 1);
});

test("a request that is not one a browser sends to a proxy is turned away without a connection", async (t) => {
  const acme = await site(t);
  const { proxy, dialled } = await proxyTo(t, acme.port);
  assert.equal((await ask({ host: HERE.address, port: proxy.port, path: "/status" })).status, 400, "a path, as if the proxy were a site");
  assert.equal((await plain(proxy.port, "https://acme.example/")).status, 400, "https is tunnelled, never sent in the open");
  const { status, socket } = await tunnel(proxy.port, "acme.example:not-a-port");
  socket.destroy();
  assert.equal(status, 400);
  assert.deepEqual([dialled, acme.seen.connections], [[], 0]);
});

test("every refusal is counted, and the first ten targets are named, each once", async (t) => {
  const acme = await site(t);
  const { proxy } = await proxyTo(t, acme.port);
  for (let i = 1; i <= 12; i++) for (const path of ["/a.png", "/b.png"]) assert.equal((await plain(proxy.port, `http://10.0.0.${i}${path}`)).status, 403);
  const refused = proxy.refused();
  assert.equal(refused.count, 24);
  assert.deepEqual(refused.targets.map((r) => r.to), Array.from({ length: 10 }, (_, i) => `10.0.0.${i + 1}:80`));
});

test("closing the proxy ends its open tunnels and frees the port", async (t) => {
  const acme = await site(t);
  const { connect } = landingOn(acme.port), { resolve } = resolver();
  const proxy = await startProxy(resolve, connect);
  const { socket } = await tunnel(proxy.port, "acme.example:443");
  const ended = new Promise((done) => socket.once("close", done));
  await proxy.close();
  await ended;
  await assert.rejects(tunnel(proxy.port, "acme.example:443"), /ECONNREFUSED/);
});

test("with the system's resolver and real connections, this machine never gets one, by name or by address", async (t) => {
  const acme = await site(t);
  const proxy = await startProxy(nodeNet.resolve);
  t.after(() => proxy.close());
  for (const target of ["localhost:443", "127.0.0.1:443", `localhost:${acme.port}`]) {
    const { status, socket } = await tunnel(proxy.port, target);
    socket.destroy();
    assert.equal(status, 403, target);
  }
  assert.equal((await plain(proxy.port, `http://localhost:${acme.port}/`)).status, 403);
  assert.equal((await plain(proxy.port, "http://localhost/")).status, 403);
  assert.equal(acme.seen.connections, 0);
  assert.match(proxy.refused().targets.find((r) => r.to === "localhost:443")?.reason ?? "", /^localhost resolves to (127\.0\.0\.1|::1), which is not a public address$/);
});
