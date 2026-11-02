// Renders an episode to PNG frames in headless Chrome (WebGL via SwiftShader) and encodes a silent MP4.
// Usage: node render.mjs <episode> [--still <seconds>] [--out <dir>]
import { createServer } from "node:http";
import { readFileSync, existsSync, mkdirSync, writeFileSync } from "node:fs";
import { spawn, spawnSync } from "node:child_process";
import { extname, join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const root = dirname(fileURLToPath(import.meta.url));
const args = process.argv.slice(2), ep = args[0];
const opt = (n) => (args.includes(n) ? args[args.indexOf(n) + 1] : null);
if (!ep) { console.error("usage: node render.mjs <episode> [--still <seconds>] [--out <dir>]"); process.exit(2); }
const out = opt("--out") ?? join(root, "out", ep); mkdirSync(join(out, "frames"), { recursive: true });
const CHROME = join(root, "../../packages/video-remotion/node_modules/.remotion/chrome-headless-shell/mac-arm64/chrome-headless-shell-mac-arm64/chrome-headless-shell");
if (!existsSync(CHROME)) { console.error(`Chrome Headless Shell missing: ${CHROME} (run a Remotion render once, see packages/video-remotion/README.md)`); process.exit(1); }

const mime = { ".html": "text/html", ".js": "text/javascript", ".mjs": "text/javascript", ".json": "application/json" };
const server = createServer((req, res) => {
  const p = join(root, decodeURIComponent(new URL(req.url, "http://x").pathname));
  if (!p.startsWith(root) || !existsSync(p)) { res.writeHead(404); return res.end(); }
  res.writeHead(200, { "content-type": mime[extname(p)] ?? "application/octet-stream" }); res.end(readFileSync(p));
}).listen(0, "127.0.0.1");
await new Promise((r) => server.once("listening", r));
const port = server.address().port, DEBUG = 9333 + (port % 500);

const chrome = spawn(CHROME, [`--remote-debugging-port=${DEBUG}`, "--no-sandbox", "--use-gl=angle", "--use-angle=swiftshader", "--enable-unsafe-swiftshader", "--ignore-gpu-blocklist", "--hide-scrollbars", "--window-size=720,1280", "about:blank"], { stdio: "ignore" });
const done = (code = 0) => { chrome.kill(); server.close(); process.exit(code); };
process.on("SIGINT", () => done(1));

let target;
for (let i = 0; i < 50 && !target; i++) { try { target = await (await fetch(`http://127.0.0.1:${DEBUG}/json/new?http://127.0.0.1:${port}/page.html?ep=${ep}`, { method: "PUT" })).json(); } catch { await new Promise((r) => setTimeout(r, 200)); } }
if (!target) { console.error("could not reach Chrome"); done(1); }
const ws = new WebSocket(target.webSocketDebuggerUrl); await new Promise((r) => (ws.onopen = r));
let id = 0; const pending = new Map(); ws.onmessage = (m) => { const d = JSON.parse(m.data); pending.get(d.id)?.(d); pending.delete(d.id); };
const call = (method, params = {}) => new Promise((res) => { const i = ++id; pending.set(i, res); ws.send(JSON.stringify({ id: i, method, params })); });
const ev = async (expression) => { const r = await call("Runtime.evaluate", { expression, returnByValue: true, awaitPromise: true }); if (r.result?.exceptionDetails) throw new Error(JSON.stringify(r.result.exceptionDetails.exception?.description ?? r.result.exceptionDetails)); return r.result.result.value; };

for (let i = 0; i < 100 && !(await ev("window.ready === true || !!window.error")); i++) await new Promise((r) => setTimeout(r, 200));
const err = await ev("window.error ?? null"); if (err) { console.error(err); done(1); }
const info = await ev("window.info"); writeFileSync(join(out, "info.json"), JSON.stringify(info, null, 2));
console.log(`episode ${ep}: ${info.duration.toFixed(2)} s @ ${info.fps} fps, marks ${JSON.stringify(info.marks)}`);

const still = opt("--still"); // comma-separated seconds
const frames = still ? still.split(",").map((s) => Math.round(Number(s) * info.fps)) : Array.from({ length: Math.ceil(info.duration * info.fps) }, (_, i) => i);
for (const [n, i] of frames.entries()) {
  const url = await ev(`window.frame(${i})`);
  writeFileSync(join(out, still ? `still-${(i / info.fps).toFixed(1)}.png` : `frames/${String(i).padStart(5, "0")}.png`), Buffer.from(url.split(",")[1], "base64"));
  if (!still && n % 60 === 0) console.log(`frame ${n}/${frames.length}`);
}
if (!still) {
  const r = spawnSync("ffmpeg", ["-y", "-loglevel", "error", "-framerate", String(info.fps), "-i", join(out, "frames/%05d.png"), "-c:v", "libx264", "-pix_fmt", "yuv420p", "-crf", "18", join(out, `${ep}-silent.mp4`)], { stdio: "inherit", env: { ...process.env, PATH: `/opt/homebrew/bin:${process.env.PATH}` } });
  console.log(r.status === 0 ? `wrote ${join(out, `${ep}-silent.mp4`)}` : "ffmpeg failed");
}
done(0);
