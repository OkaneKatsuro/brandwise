// The adapter that renders a page in a child process. Around a child that only pretends to be the engine: what it hands back,
// how it fails, its time limit and what it leaves behind. And the whole render with a real Chrome, when the optional engine
// (packages/email-engine) and a Chrome are installed, skipped without them: a made-up company's page is served from this
// machine, the proxy lands its name here, and look.mjs reads it. The rules themselves are tested without a browser: the proxy's
// in proxy.test.ts, the candidates' in look.test.ts.
import assert from "node:assert/strict";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import http from "node:http";
import net, { type AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test, type TestContext } from "node:test";
import { findChrome } from "../email/templates/adapters/chrome-preview.ts";
import { chromeRender } from "./chrome-render.ts";
import { lookCandidates } from "./look.ts";
import { startProxy } from "./proxy.ts";
import { PUBLIC } from "./testing.ts";

const engine = join(import.meta.dirname, "..", "..", "..", "email-engine");
const videoEngine = join(import.meta.dirname, "..", "..", "..", "video-remotion");
const installed = existsSync(join(engine, "node_modules", "puppeteer-core")) && findChrome("", videoEngine) !== null;

/**
 * A folder that passes for the engine: `look.mjs` is the script the test gives it, which gets what the real one gets
 * (`<chrome> <address> <proxy port> <png file>`) and may leave notes for the test in its own folder.
 */
function pretendEngine(t: TestContext, lookMjs: string) {
  const dir = mkdtempSync(join(tmpdir(), "bw-engine-"));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  mkdirSync(join(dir, "node_modules", "puppeteer-core"), { recursive: true });
  writeFileSync(join(dir, "look.mjs"), lookMjs);
  const note = (name: string) => readFileSync(join(dir, name), "utf8");
  // any file that exists passes for a Chrome here: the pretend engine never starts it
  return { note, render: chromeRender({ enginePath: dir, chromePath: process.execPath }) };
}
const NOTES = 'import { writeFileSync } from "node:fs"; import { dirname, join } from "node:path"; const [, address, proxyPort, png] = process.argv.slice(2); const note = (name, text) => writeFileSync(join(import.meta.dirname, name), String(text));';
const alive = (pid: number) => { try { process.kill(pid, 0); return true; } catch { return false; } };

test("the adapter hands back the picture the engine wrote and what it printed, whole, and removes the folder the picture was written to", async (t) => {
  // more than one pipe can carry at once, in a script whose characters take three bytes each: some arrive in two pieces
  const family = "游ゴシック体".repeat(40_000);
  const engine = pretendEngine(t, `${NOTES} note("asked", [address, proxyPort].join(" ")); note("folder", dirname(png)); writeFileSync(png, "a picture");
    process.stdout.write(JSON.stringify({ url: address, body: { fontFamily: ${JSON.stringify(family)} } }));`);
  const rendered = await engine.render({ url: "https://acme.example/", proxyPort: 49152, timeoutMs: 20_000 });
  assert.equal(Buffer.from(rendered.png).toString(), "a picture");
  assert.equal(rendered.page.url, "https://acme.example/");
  assert.equal(rendered.page.body?.fontFamily, family, "no character was broken on the way");
  assert.equal(engine.note("asked"), "https://acme.example/ 49152", "the engine is given the address and the proxy");
  assert.equal(existsSync(engine.note("folder")), false);
});

test("an engine that fails gives its reason, in one bounded line; one that prints no page or writes no picture has made none", async (t) => {
  const failing = (script: string, why: RegExp) => assert.rejects(pretendEngine(t, `${NOTES} ${script}`).render({ url: "https://acme.example/", proxyPort: 49152, timeoutMs: 20_000 }), why);
  await failing('process.stderr.write("net::ERR_NAME_NOT_RESOLVED at https://acme.example/"); process.exitCode = 1;', /^Error: Chrome made no picture of the page: net::ERR_NAME_NOT_RESOLVED at https:\/\/acme\.example\/$/);
  await failing('process.stderr.write("x".repeat(5000)); process.exitCode = 1;', /^Error: Chrome made no picture of the page: x{300}$/);
  await failing('writeFileSync(png, "a picture"); process.stdout.write("not a page");', /^Error: Chrome made no picture of the page: no output$/);
  await failing('process.stdout.write("{}");', /^Error: Chrome made no picture of the page: no output$/);
});

test("a render that takes longer than its time is stopped, and is over only when the child is gone; a child that will not stop is killed", async (t) => {
  for (const [what, script] of [["stops when told", ""], ["ignores being told", 'process.on("SIGTERM", () => {});']] as const) {
    const engine = pretendEngine(t, `${NOTES} ${script} note("pid", process.pid); note("folder", dirname(png)); setInterval(() => {}, 1000);`);
    const started = Date.now();
    await assert.rejects(engine.render({ url: "https://acme.example/", proxyPort: 49152, timeoutMs: 1000 }), { name: "TimeoutError" }, what);
    assert.deepEqual([alive(Number(engine.note("pid"))), existsSync(engine.note("folder"))], [false, false], `${what}: nothing is left running, and nothing on disk`);
    assert.ok(Date.now() - started < 8000, `${what}: within the time limit and a few seconds`);
  }
});

test("without the engine no render is tried, and the error says how to install it", async (t) => {
  const empty = mkdtempSync(join(tmpdir(), "bw-engine-"));
  t.after(() => rmSync(empty, { recursive: true, force: true }));
  for (const enginePath of ["", empty]) {
    await assert.rejects(chromeRender({ enginePath })({ url: "https://acme.example/", proxyPort: 49152, timeoutMs: 1000 }),
      /^Error: The engine that drives Chrome is not installed: run npm install in packages\/email-engine and set the plugin setting emailEnginePath to that folder\.$/);
  }
});

// ---- real Chrome, when installed ---------------------------------------------------------------------------------------------

/** The page of a made-up company. Its script would repaint it, and two of its images are on addresses no page may reach. */
const page = (port: number) => `<!doctype html><html><head><title>Acme</title>
<link rel="icon" href="/favicon.svg"><meta property="og:image" content="/og.png">
<style>
  html { background: #f6f7f9 }
  body { margin: 0; background: #ffffff; color: rgb(20, 22, 26); font-family: "Acme Sans", Helvetica, sans-serif }
  header { padding: 16px } header a { color: inherit }
  h1 { color: #0b1f44; font-family: Georgia, serif }
  p a { color: #1f6feb }
  header a.start { background: #1f6feb; color: oklch(1 0 0); padding: 12px 20px }
</style></head><body>
<header><img src="/logo.png" alt="Acme" width="120" height="32"><a href="/pricing">Pricing</a><a class="start" href="/start">Start free</a></header>
<h1>Widgets for founders</h1><p>Made in Bratislava, see <a href="/docs">the docs</a>.</p>
<img src="http://10.0.0.5/pixel.png" alt=""><img src="http://127.0.0.1:${port}/on-this-machine.png" alt="">
<div style="height: 3000px"></div>
<script>document.body.style.background = "#ff0000"; document.querySelector("h1").style.color = "#ff0000";</script>
</body></html>`;

/**
 * The made-up company's site on this machine, behind the real proxy: acme.example is a public name here, and every connection
 * the proxy lets through lands on the site. `/` is the page; `/members` is what a site shows a browser it does not let in.
 */
async function acmeBehindProxy(t: TestContext) {
  const asked: string[] = [];
  const site = http.createServer((req, res) => {
    asked.push(req.url ?? "");
    if (req.url === "/") res.writeHead(200, { "content-type": "text/html; charset=utf-8" }).end(page((site.address() as AddressInfo).port));
    else if (req.url === "/members") res.writeHead(403, { "content-type": "text/html; charset=utf-8" }).end("<h1>Just a moment</h1><p>Checking your browser.</p>");
    else res.writeHead(404).end();
  });
  await new Promise<void>((resolve) => site.listen(0, "127.0.0.1", resolve));
  t.after(() => { site.closeAllConnections(); site.close(); });
  const port = (site.address() as AddressInfo).port;
  const proxy = await startProxy(async (host) => (host === "acme.example" ? [{ address: PUBLIC, family: 4 }] : []), (to) => net.connect({
    host: to.host, port, lookup: (host, options, done) => to.lookup(host, options, (err) => (err ? done(err, []) : options.all ? done(null, [{ address: "127.0.0.1", family: 4 }]) : done(null, "127.0.0.1", 4))),
  }));
  t.after(() => proxy.close());
  const render = (path: string) => chromeRender({ enginePath: engine, videoEnginePath: videoEngine })({ url: `http://acme.example${path}`, proxyPort: proxy.port, timeoutMs: 60_000 });
  return { asked, port, proxy, render };
}

test("real Chrome: a page that answers the browser with anything but 200 gives no look, whatever it shows", { skip: !installed }, async (t) => {
  const { render } = await acmeBehindProxy(t);
  await assert.rejects(render("/members"), /^Error: Chrome made no picture of the page: the page answered the browser with HTTP 403$/);
});

test("real Chrome: the page is rendered with its scripts off and only through the proxy, pictured two screens high, and read into candidates", { skip: !installed }, async (t) => {
  const { asked, port, proxy, render } = await acmeBehindProxy(t);
  const rendered = await render("/");

  const png = Buffer.from(rendered.png);
  assert.deepEqual([png.subarray(1, 4).toString(), png.readUInt32BE(16), png.readUInt32BE(20)], ["PNG", 1440, 1800], "the top of the page: 1440 wide, two screens high");
  assert.equal(rendered.page.url, "http://acme.example/");
  const look = lookCandidates(rendered.page);
  assert.deepEqual(look.colors, {
    background: { value: "#ffffff", from: "body" },
    text: { value: "#14161a", from: "the first paragraph" },
    heading: { value: "#0b1f44", from: "the first h1" },
    link: { value: "#1f6feb", from: "the first link in a paragraph" },
    button: { value: "#1f6feb", from: "the first filled link in the header" },
    buttonText: { value: "#ffffff", from: "the text on that button" },
  }, "as the stylesheet says: the page's script, which would paint it red, did not run");
  assert.deepEqual(look.fonts, { heading: { value: "Georgia", from: "the first h1" }, body: { value: "Acme Sans", from: "the first paragraph" } });
  assert.deepEqual(look.logos, [
    { from: "the page's icon", url: "http://acme.example/favicon.svg" },
    { from: "the first image in the header", url: "http://acme.example/logo.png" },
    { from: "the OpenGraph image", url: "http://acme.example/og.png" },
  ]);
  assert.equal(look.note, null);

  assert.ok(asked.includes("/") && asked.includes("/logo.png"), `what the page names on its own site is fetched through the proxy: ${asked}`);
  assert.ok(!asked.includes("/on-this-machine.png"), "this machine is not reached around the proxy");
  const refused = proxy.refused();
  assert.deepEqual(refused.targets.map((r) => r.to).sort(), ["10.0.0.5:80", `127.0.0.1:${port}`].sort(), "and the proxy refused both");
  assert.ok(refused.count >= 2);
});
