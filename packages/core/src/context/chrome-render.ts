// Render adapter: a stranger's page rendered by @brandwise/email-engine (puppeteer-core) in a child process, for the company's
// look. The Chrome is the one the e-mail preview finds (findChrome); look.mjs of the engine holds it to the proxy and switches
// the page's scripts off. A render is over when the child is gone: it is stopped when its time is up, and what it wrote is
// removed whatever happens.
import { spawn } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { findChrome } from "../email/templates/adapters/chrome-preview.ts";
import type { Render } from "./research.ts";

/** What the child prints is the computed values of a bounded number of elements; whatever is longer is cut and then does not parse. */
const MAX_OUTPUT = 2_000_000;
/** A child that is told to stop closes its Chrome and ends. One that is still there after this long is killed. */
const GRACE_MS = 3_000;

export function chromeRender(opts: { enginePath: string; chromePath?: string; videoEnginePath?: string }): Render {
  const script = join(opts.enginePath, "look.mjs");
  return ({ url, proxyPort, timeoutMs }) => new Promise((resolve, reject) => {
    if (!opts.enginePath || !existsSync(script) || !existsSync(join(opts.enginePath, "node_modules", "puppeteer-core"))) {
      return reject(new Error("The engine that drives Chrome is not installed: run npm install in packages/email-engine and set the plugin setting emailEnginePath to that folder."));
    }
    const chrome = findChrome(opts.chromePath ?? "", opts.videoEnginePath ?? "");
    if (!chrome) return reject(new Error("No Chrome found to render the page: set the plugin setting chromePath, or install the video engine (it brings a headless Chrome)."));
    const dir = mkdtempSync(join(tmpdir(), "bw-look-"));
    const png = join(dir, "look.png");
    let out = "", err = "", late = false, kill: NodeJS.Timeout | undefined;
    const child = spawn(process.execPath, [script, chrome, url, String(proxyPort), png], { cwd: opts.enginePath, stdio: ["ignore", "pipe", "pipe"] });
    // as text from the start: a character that arrives in two pieces (a font named in Japanese) is put together again
    child.stdout.setEncoding("utf8").on("data", (chunk) => { if (out.length < MAX_OUTPUT) out += chunk; });
    child.stderr.setEncoding("utf8").on("data", (chunk) => { if (err.length < MAX_OUTPUT) err += chunk; });
    const timer = setTimeout(() => {
      late = true;
      child.kill();
      kill = setTimeout(() => child.kill("SIGKILL"), GRACE_MS);
    }, timeoutMs);
    const finish = (settle: () => void) => { clearTimeout(timer); clearTimeout(kill); settle(); rmSync(dir, { recursive: true, force: true }); };
    child.on("error", (cause) => finish(() => reject(cause)));
    child.on("close", () => finish(() => {
      if (late) return reject(new DOMException("no picture in time", "TimeoutError"));
      try {
        resolve({ png: new Uint8Array(readFileSync(png)), page: JSON.parse(out) });
      } catch {
        reject(new Error(`Chrome made no picture of the page: ${err.trim().slice(0, 300) || "no output"}`));
      }
    }));
  });
}
