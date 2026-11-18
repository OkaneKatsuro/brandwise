// Reading a site without a network: the fence of research.ts around a made-up network (testing.ts), and the real transport
// against a server on this machine. What a page says is in site.test.ts, what is stored in research.db.test.ts.
import assert from "node:assert/strict";
import type { LookupAddress } from "node:dns";
import http from "node:http";
import type { AddressInfo, LookupFunction } from "node:net";
import { test } from "node:test";
import { nodeNet, readSite, type Net } from "./research.ts";
import { html, madeUp, nav, PUBLIC, type Served } from "./testing.ts";

const to = (location: string, status = 302): Served => ({ status, location });

const ACME = { "acme.example": [PUBLIC] };
const reasons = (read: { skipped: { url: string; reason: string }[] }) => Object.fromEntries(read.skipped.map((s) => [new URL(s.url).pathname, s.reason]));

for (const all of [false, true]) test(`a site is read from the page asked for and the pages its navigation links to, one request at a time, under our name (lookup for ${all ? "every address" : "one address"})`, async () => {
  const { net, seen } = madeUp({ "acme.example": [PUBLIC, "2606:2800:220:1:248:1893:25c8:1946"] }, {
    "https://acme.example/robots.txt": { type: "text/plain", body: "User-agent: *\nDisallow: /admin/\n" },
    "https://acme.example/": html("Acme", `${nav("/pricing", "/about")}<h1>Widgets for founders</h1>`),
    "https://acme.example/pricing": html("Pricing", "<p>Solo: 19 EUR</p>"),
    "https://acme.example/about": html("About", `${nav("/team")}<p>Made in Bratislava</p>`),
    "https://acme.example/team": html("Team"),
  }, all);
  const read = await readSite(net, "https://acme.example/#hero");
  assert.equal(read.site, "https://acme.example");
  assert.deepEqual(read.pages.map((p) => [p.url, p.title, p.text]), [
    ["https://acme.example/", "Acme", "/pricing /about\n# Widgets for founders"],
    ["https://acme.example/pricing", "Pricing", "Solo: 19 EUR"],
    ["https://acme.example/about", "About", "/team\nMade in Bratislava"],
  ]);
  assert.deepEqual(read.skipped, []);
  assert.deepEqual(seen.requests, ["https://acme.example/robots.txt", "https://acme.example/", "https://acme.example/pricing", "https://acme.example/about"],
    "robots.txt first and once; only the first page's links are followed");
  assert.equal(seen.atOnce, 1, "never two requests at the same time");
  assert.ok(seen.connections.every((address) => address === PUBLIC), "every connection goes to the address that was checked");
  assert.ok(seen.headers.every((h) => /^BrandWise \(.*\+https:\/\//.test(h["user-agent"]) && h["accept-encoding"] === "identity"), "our name, and no compression");
});

test("an address that is not a public web address is refused before anything is requested", async () => {
  const { net, seen } = madeUp({ ...ACME, "intranet.example": ["10.0.0.5"], "both.example": [PUBLIC, "127.0.0.1"], "six.example": ["::1"], "mapped.example": ["::ffff:192.168.1.1"], "empty.example": [] }, {});
  for (const [address, reason] of [
    ["http://127.0.0.1:8080/admin", /http:\/\/127\.0\.0\.1:8080\/admin was not read: 127\.0\.0\.1 is not a public address/],
    ["http://169.254.169.254/latest/meta-data/", /169\.254\.169\.254 is not a public address/],
    ["http://2130706433/", /127\.0\.0\.1 is not a public address/],
    ["http://[::1]/", /::1 is not a public address/],
    ["ftp://acme.example/", /was not read: only http and https addresses are read/],
    ["file:///etc/passwd", /only http and https addresses are read/],
    ["localhost:3000", /only http and https addresses are read/],
    ["https://admin:secret@acme.example/", /a user name or a password in it is not read/],
    ["acme.example", /"acme\.example" is not an address: give the whole address of a page, like https:\/\/example\.com/],
    ["", /is not an address/],
  ] as const) await assert.rejects(readSite(net, address), reason, address);
  assert.deepEqual(seen.requests, [], "nothing was requested");

  for (const [address, reason] of [
    ["https://intranet.example/", /was not read: its robots\.txt was not read: intranet\.example resolves to 10\.0\.0\.5, which is not a public address/],
    ["https://both.example/", /both\.example resolves to 127\.0\.0\.1, which is not a public address/],
    ["https://six.example/", /six\.example resolves to ::1, which is not a public address/],
    ["https://mapped.example/", /mapped\.example resolves to ::ffff:192\.168\.1\.1, which is not a public address/],
    ["https://nowhere.example/", /cannot be reached \(getaddrinfo ENOTFOUND nowhere\.example\)/],
    ["https://empty.example/", /cannot be reached \(empty\.example has no address\)/],
  ] as const) await assert.rejects(readSite(net, address), reason, address);
  assert.deepEqual([seen.requests, seen.connections], [[], []], "a name is judged by all its answers when it is resolved, and no connection is made");
});

test("a name is judged again at every connection: one that turns to a private address after the first answer gains nothing", async () => {
  const { net, seen } = madeUp(ACME, {
    "https://acme.example/robots.txt": { status: 404 },
    "https://acme.example/": html("Acme", nav("/pricing")),
    "https://acme.example/pricing": html("Pricing"),
  });
  let answers = 0;
  const turning: Net = { request: net.request, resolve: async () => [{ address: ++answers <= 2 ? PUBLIC : "169.254.169.254", family: 4 }] };
  const read = await readSite(turning, "https://acme.example/");
  assert.deepEqual(read.pages.map((p) => p.title), ["Acme"]);
  assert.deepEqual(read.skipped, [{ url: "https://acme.example/pricing", reason: "acme.example resolves to 169.254.169.254, which is not a public address" }]);
  assert.deepEqual(seen.connections, [PUBLIC, PUBLIC], "robots.txt and the first page; the third answer was never connected to");
});

test("a redirect is followed by hand, at most 5 times, and every hop passes the same fence", async () => {
  const { net, seen } = madeUp({ ...ACME, "intranet.example": ["10.0.0.5"], "rebound.example": [PUBLIC, "169.254.169.254"] }, {
    "https://acme.example/": html("Acme", nav("/old", "/metadata", "/intranet", "/rebound", "/file", "/login", "/loop/0", "/hops/0", "/nowhere", "/lost")),
    "https://acme.example/old": to("/new#pricing", 301),
    "https://acme.example/new": html("New"),
    "https://acme.example/metadata": to("http://169.254.169.254/latest/meta-data/"),
    "https://acme.example/intranet": to("https://intranet.example/wiki", 307),
    "https://acme.example/rebound": to("https://rebound.example/"),
    "https://acme.example/file": to("file:///etc/passwd"),
    "https://acme.example/login": to("https://user:pw@acme.example/account"),
    ...Object.fromEntries(Array.from({ length: 7 }, (_, i) => [`https://acme.example/loop/${i}`, to(`/loop/${i + 1}`, 308)])),
    ...Object.fromEntries(Array.from({ length: 5 }, (_, i) => [`https://acme.example/hops/${i}`, to(`/hops/${i + 1}`, 303)])),
    "https://acme.example/hops/5": html("Five hops"),
    "https://acme.example/nowhere": { status: 302 },
    "https://acme.example/lost": to("/gone"),
  });
  const read = await readSite(net, "https://acme.example/");
  assert.deepEqual(read.pages.map((p) => [p.url, p.title]), [["https://acme.example/", "Acme"], ["https://acme.example/new", "New"], ["https://acme.example/hops/5", "Five hops"]],
    "a page is known by the address it was read from");
  assert.deepEqual(reasons(read), {
    "/metadata": "redirects to http://169.254.169.254/latest/meta-data/: 169.254.169.254 is not a public address",
    "/intranet": "redirects to https://intranet.example/wiki: it is on another site",
    "/rebound": "redirects to https://rebound.example/: it is on another site",
    "/file": "redirects to file:///etc/passwd: only http and https addresses are read",
    "/login": "redirects to https://user:pw@acme.example/account: an address with a user name or a password in it is not read",
    "/loop/0": "redirects more than 5 times",
    "/nowhere": "answered HTTP 302",
    "/lost": "redirects to https://acme.example/gone: answered HTTP 404",
  });
  assert.ok(seen.connections.every((address) => address === PUBLIC), "no hop reached an address that is not public");
  assert.ok(!seen.requests.includes("https://acme.example/loop/6"), "the sixth redirect is not followed");
});

test("the page asked for may move to another site, which is then the site that is read; its redirects pass the same fence", async () => {
  const names = { ...ACME, "www.acme.example": [PUBLIC], "intranet.example": ["10.0.0.5"], "moved.example": [PUBLIC], "closed.example": [PUBLIC] };
  const { net, seen } = madeUp(names, {
    "http://acme.example/": to("https://acme.example/", 301),
    "https://acme.example/": to("https://www.acme.example/", 301),
    "https://www.acme.example/": html("Acme", nav("/pricing", "https://acme.example/old-home", "https://www.acme.example/away")),
    "https://www.acme.example/pricing": html("Pricing"),
    "https://www.acme.example/away": to("https://acme.example/"),
    "https://moved.example/": to("https://intranet.example/"),
    "http://moved.example/metadata": to("http://169.254.169.254/latest/meta-data/iam/"),
    "https://closed.example/robots.txt": { type: "text/plain", body: "User-agent: *\nDisallow: /\n" },
    "https://moved.example/closed": to("https://closed.example/"),
  });
  const read = await readSite(net, "http://acme.example/");
  assert.equal(read.site, "https://www.acme.example");
  assert.deepEqual(read.pages.map((p) => p.url), ["https://www.acme.example/", "https://www.acme.example/pricing"], "the old site's address is not one of this site's pages");
  assert.deepEqual(read.skipped, [{ url: "https://www.acme.example/away", reason: "redirects to https://acme.example/: it is on another site" }], "a linked page that leaves the site is skipped");
  assert.deepEqual(seen.requests.filter((r) => r.endsWith("/robots.txt")), ["http://acme.example/robots.txt", "https://acme.example/robots.txt", "https://www.acme.example/robots.txt"],
    "each site on the way is asked for its robots.txt, once");

  await assert.rejects(readSite(net, "https://moved.example/"), /https:\/\/moved\.example\/ was not read: redirects to https:\/\/intranet\.example\/: its robots\.txt was not read: intranet\.example resolves to 10\.0\.0\.5, which is not a public address/);
  await assert.rejects(readSite(net, "http://moved.example/metadata"), /redirects to http:\/\/169\.254\.169\.254\/latest\/meta-data\/iam\/: 169\.254\.169\.254 is not a public address/);
  await assert.rejects(readSite(net, "https://moved.example/closed"), /redirects to https:\/\/closed\.example\/: robots\.txt disallows it/, "the robots.txt of the site it moved to counts");
  assert.ok(seen.connections.every((address) => address === PUBLIC));
});

test("robots.txt is honoured: a disallowed page is skipped, a site that disallows the page asked for is not read", async () => {
  const pages = {
    "https://acme.example/": html("Acme", nav("/pricing", "/admin/users", "/moved", "/search?q=widgets")),
    "https://acme.example/pricing": html("Pricing"),
    "https://acme.example/admin/users": html("Users"),
    "https://acme.example/moved": to("/admin/moved"),
    "https://acme.example/search?q=widgets": html("Search"),
  };
  const withRobots = (robots: Served) => madeUp(ACME, { ...pages, "https://acme.example/robots.txt": robots });

  const some = withRobots({ type: "text/plain", body: "User-agent: *\nDisallow: /admin/\nDisallow: /search\n" });
  const read = await readSite(some.net, "https://acme.example/");
  assert.deepEqual(read.pages.map((p) => p.title), ["Acme", "Pricing"]);
  assert.deepEqual(reasons(read), { "/admin/users": "robots.txt disallows it", "/moved": "redirects to https://acme.example/admin/moved: robots.txt disallows it", "/search": "robots.txt disallows it" });
  assert.ok(!some.seen.requests.some((r) => r.includes("/admin/") || r.includes("/search")), "what is disallowed is never requested");

  const ours = withRobots({ type: "text/plain", body: "User-agent: *\nDisallow: /\n\nUser-agent: BrandWise\nDisallow: /pricing\n" });
  assert.deepEqual((await readSite(ours.net, "https://acme.example/")).pages.map((p) => p.title), ["Acme", "Users", "Search"], "rules written for us replace those for everyone");

  const endless = withRobots({ type: "text/plain", body: `User-agent: *\nDisallow: /admin/\n${"# and so on\n".repeat(200_000)}Disallow: /pricing\n` });
  assert.deepEqual((await readSite(endless.net, "https://acme.example/")).pages.map((p) => p.title), ["Acme", "Pricing", "Search"], "of a robots.txt over the size limit, the part that was read counts");

  const closed = withRobots({ type: "text/plain", body: "User-agent: *\nDisallow: /\n" });
  await assert.rejects(readSite(closed.net, "https://acme.example/"), /https:\/\/acme\.example\/ was not read: robots\.txt disallows it/);
  assert.deepEqual(closed.seen.requests, ["https://acme.example/robots.txt"]);

  for (const none of [{ status: 404 }, { status: 403 }, { status: 410 }]) {
    const open = withRobots(none);
    assert.equal((await readSite(open.net, "https://acme.example/")).pages.length, 4, `a site without a robots.txt (HTTP ${none.status}) allows everything`);
  }
  await assert.rejects(readSite(withRobots({ status: 503 }).net, "https://acme.example/"), /was not read: its robots\.txt answered HTTP 503/, "a robots.txt that cannot be read forbids everything");
  await assert.rejects(readSite(withRobots({ timesOut: true }).net, "https://acme.example/"), /was not read: its robots\.txt was not read: no answer within 10 s/);
  const elsewhere = madeUp({ ...ACME, "cdn.example": [PUBLIC] }, { ...pages, "https://acme.example/robots.txt": to("https://cdn.example/acme-robots.txt"), "https://cdn.example/acme-robots.txt": { type: "text/plain", body: "User-agent: *\nDisallow: /pricing\n" } });
  assert.deepEqual((await readSite(elsewhere.net, "https://acme.example/")).pages.map((p) => p.title), ["Acme", "Users", "Search"], "a robots.txt may itself be served from elsewhere");
});

test("only HTML of a bearable size is read: anything else is skipped with the reason, and its body is not read", async () => {
  const { net, seen } = madeUp(ACME, {
    "https://acme.example/": html("Acme", nav("/brochure.pdf", "/feed", "/untyped", "/huge", "/fits", "/gone", "/error", "/zipped", "/slow", "/pricing")),
    "https://acme.example/brochure.pdf": { type: "application/pdf", body: "%PDF-1.7" },
    "https://acme.example/feed": { type: "application/rss+xml; charset=utf-8", body: "<rss/>" },
    "https://acme.example/untyped": { type: "", body: "<p>Who knows" },
    "https://acme.example/huge": { body: `<p>${"x".repeat(2_000_000)}` },
    "https://acme.example/fits": { body: `<title>Fits</title>${"x".repeat(2_000_000 - "<title>Fits</title>".length)}` },
    "https://acme.example/gone": { status: 404, body: "<p>Not found" },
    "https://acme.example/error": { status: 500 },
    "https://acme.example/zipped": { encoding: "gzip", body: "\u001f\u008b" },
    "https://acme.example/slow": { timesOut: true },
    "https://acme.example/pricing": html("Pricing"),
  });
  const read = await readSite(net, "https://acme.example/");
  assert.deepEqual(read.pages.map((p) => p.title), ["Acme", "Fits", "Pricing"], "a page that cannot be read does not stop the read");
  assert.deepEqual(reasons(read), {
    "/brochure.pdf": "not HTML (application/pdf)",
    "/feed": "not HTML (application/rss+xml)",
    "/untyped": "not HTML (no usable content type)",
    "/huge": "larger than 2 MB",
    "/gone": "answered HTTP 404",
    "/error": "answered HTTP 500",
    "/zipped": "sent compressed although plain text was asked for",
    "/slow": "no answer within 10 s",
  });
  assert.deepEqual(seen.bodies.map((b) => new URL(b).pathname), ["/", "/huge", "/fits", "/pricing"], "a body is read only when the head says it is a page, and then only up to the limit");

  const pdf = madeUp(ACME, { "https://acme.example/brochure.pdf": { type: "application/pdf", body: "%PDF-1.7" } });
  await assert.rejects(readSite(pdf.net, "https://acme.example/brochure.pdf"), /https:\/\/acme\.example\/brochure\.pdf was not read: not HTML \(application\/pdf\)/, "the page asked for is refused, not skipped");
});

test("a page and its redirects share one time limit", async () => {
  const { net, seen } = madeUp(ACME, {
    "https://acme.example/robots.txt": { status: 404 },
    "https://acme.example/": to("/a"),
    "https://acme.example/a": to("/b"),
    "https://acme.example/b": html("Acme"),
  });
  await readSite(net, "https://acme.example/");
  const [robots, first, second, third] = seen.timeouts;
  assert.ok(robots <= 10_000 && first <= 10_000 && first > 9_000, `10 s for a page: ${first}`);
  assert.ok(second < first && third < second, `each hop gets what the hops before it left: ${first}, ${second}, ${third}`);
});

test("the page asked for and the first links are read, up to the number of pages asked for: 12 unless told otherwise, 30 at most", async () => {
  const links = Array.from({ length: 40 }, (_, i) => `/p${i}`);
  const { net } = madeUp(ACME, { "https://acme.example/": html("Acme", nav(...links)), ...Object.fromEntries(links.map((l) => [`https://acme.example${l}`, html(l)])), "https://acme.example/p1": { status: 404 } });
  const twelve = await readSite(net, "https://acme.example/");
  assert.deepEqual([twelve.pages.length, twelve.skipped.length, twelve.pages.at(-1)?.title], [11, 1, "/p10"], "12 addresses: a page that is skipped still counts");
  assert.deepEqual((await readSite(net, "https://acme.example/", 1)).pages.map((p) => p.title), ["Acme"]);
  assert.deepEqual((await readSite(net, "https://acme.example/", 3)).pages.map((p) => p.title), ["Acme", "/p0"]);
  assert.equal((await readSite(net, "https://acme.example/", 30)).pages.length, 29);
  for (const pages of [0, 31, 2.5, Number.NaN]) await assert.rejects(readSite(net, "https://acme.example/", pages), /whole number from 1 to 30/, String(pages));
});

test("a page that two addresses lead to is read once", async () => {
  const { net } = madeUp(ACME, {
    "https://acme.example/": html("Acme", nav("/about", "/about-us", "/home")),
    "https://acme.example/about": html("About"),
    "https://acme.example/about-us": to("/about", 301),
    "https://acme.example/home": to("/", 301),
  });
  const read = await readSite(net, "https://acme.example/");
  assert.deepEqual(read.pages.map((p) => p.url), ["https://acme.example/", "https://acme.example/about"]);
  assert.deepEqual(reasons(read), { "/about-us": "redirects to https://acme.example/about, which was already read", "/home": "redirects to https://acme.example/, which was already read" });
});

/** A server on this machine and a `lookup` that sends any name to it: what the real transport is tried against. */
async function local(handler: http.RequestListener) {
  const server = http.createServer(handler);
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const here: LookupAddress = { address: "127.0.0.1", family: 4 };
  const lookup: LookupFunction = (_host, options, done) => (options.all ? done(null, [here]) : done(null, here.address, here.family));
  return { server, lookup, port: (server.address() as AddressInfo).port, close: () => new Promise((resolve) => { server.closeAllConnections(); server.close(resolve); }) };
}
const options = (lookup: LookupFunction, over: Partial<Parameters<Net["request"]>[1]> = {}) => ({ lookup, headers: { "user-agent": "test" }, timeoutMs: 5000, maxBytes: 1000, wants: () => true, ...over });

test("the real transport: connects where the lookup says, sends the headers, reads a body only when wanted and only up to the limit, gives up in time", async () => {
  const asked: http.IncomingHttpHeaders[] = [];
  const { lookup, port, close } = await local((req, res) => {
    asked.push(req.headers);
    if (req.url === "/moved") res.writeHead(301, { location: "/new" }).end();
    else if (req.url === "/large") res.writeHead(200, { "content-type": "text/html" }).end("x".repeat(100_000));
    else if (req.url === "/stalls") res.writeHead(200, { "content-type": "text/html" }).write("<p>half");
    else if (req.url === "/breaks") res.writeHead(200, { "content-type": "text/html", "content-length": "1000" }).write("<p>half", () => res.destroy());
    else if (req.url !== "/silent") res.writeHead(200, { "content-type": "text/html; charset=utf-8", "content-encoding": "identity" }).end("<p>Hello");
  });
  try {
    const at = (path: string) => new URL(`http://a-name-that-does-not-exist.example:${port}${path}`);
    const page = await nodeNet.request(at("/"), options(lookup, { headers: { "user-agent": "BrandWise test", "accept-encoding": "identity" } }));
    assert.deepEqual([page.status, page.contentType, page.contentEncoding, page.location, Buffer.from(page.body).toString(), page.truncated], [200, "text/html; charset=utf-8", "identity", undefined, "<p>Hello", false]);
    assert.deepEqual([asked[0]["user-agent"], asked[0]["accept-encoding"], asked[0].host], ["BrandWise test", "identity", `a-name-that-does-not-exist.example:${port}`], "the name is in the request, the connection went where the lookup said");

    const moved = await nodeNet.request(at("/moved"), options(lookup));
    assert.deepEqual([moved.status, moved.location, moved.body.length], [301, "/new", 0], "a redirect is handed back, not followed");
    const unwanted = await nodeNet.request(at("/large"), options(lookup, { wants: (head) => head.status !== 200 }));
    assert.deepEqual([unwanted.status, unwanted.body.length, unwanted.truncated], [200, 0, false]);
    const large = await nodeNet.request(at("/large"), options(lookup));
    assert.ok(large.truncated && large.body.length <= 1000, `reading stops at the limit: ${large.body.length}`);
    const whole = await nodeNet.request(at("/large"), options(lookup, { maxBytes: 100_000 }));
    assert.deepEqual([whole.truncated, whole.body.length], [false, 100_000]);

    await assert.rejects(nodeNet.request(at("/breaks"), options(lookup)), /aborted|ECONNRESET|socket hang up/, "a reply that breaks off is a failure, not a short page");
    for (const path of ["/silent", "/stalls"]) {
      const started = Date.now();
      await assert.rejects(nodeNet.request(at(path), options(lookup, { timeoutMs: 150 })), { name: "TimeoutError" }, path);
      assert.ok(Date.now() - started < 2000, "without waiting for the server");
    }
  } finally {
    await close();
  }
});

test("through the real transport, a name that resolves to this machine never gets a connection", async () => {
  let connections = 0;
  const { server, port, close } = await local((_req, res) => res.writeHead(200, { "content-type": "text/html" }).end("<title>Private</title>"));
  server.on("connection", () => connections++);
  try {
    const net: Net = { request: nodeNet.request, resolve: async () => [{ address: "127.0.0.1", family: 4 }] };
    await assert.rejects(readSite(net, `http://rebound.example:${port}/`), /rebound\.example resolves to 127\.0\.0\.1, which is not a public address/);
    await assert.rejects(readSite(nodeNet, `http://localhost:${port}/`), /localhost resolves to (127\.0\.0\.1|::1), which is not a public address/, "the system's own resolver, the real lookup");
    await assert.rejects(readSite(nodeNet, `http://127.0.0.1:${port}/`), /127\.0\.0\.1 is not a public address/);
    assert.equal(connections, 0);
  } finally {
    await close();
  }
});
