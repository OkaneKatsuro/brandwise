// BytePlus provider on recorded response shapes (no network): what a task costs, what is sent, what is refused before anything is
// sent, and how the API's answers are read.
import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { byteplusOn } from "./byteplus.ts";
import { isFailed } from "./higgsfield.ts";
import type { GenSpec, ProviderConfig } from "./index.ts";

const TASKS = "https://ark.ap-southeast.bytepluses.com/api/v3/contents/generations/tasks";
const MINI = "dreamina-seedance-2-0-mini-260615", FAST = "dreamina-seedance-2-0-fast-260128", FULL = "dreamina-seedance-2-0-260128";
/** The settings of a scope with this key; null is a scope that has none. */
const cfg = (apiKey: string | null = "KEY"): ProviderConfig => ({ profilesDir: "/nowhere", values: apiKey === null ? {} : { apiKey } });
const spec = (over: Partial<GenSpec> = {}): GenSpec => ({ model: MINI, prompt: "A cup of coffee on a desk, morning light", ...over });

type Call = { method: string; url: string; auth: string | null; body: any };
/** A BytePlus that answers from `answer` and remembers what it was asked. */
function fake(answer: (call: Call) => unknown) {
  const calls: Call[] = [];
  const fetchImpl = (async (input: URL | string, init: any) => {
    const call: Call = { method: init?.method ?? "GET", url: String(input), auth: init?.headers?.authorization ?? null, body: init?.body === undefined ? null : JSON.parse(init.body) };
    calls.push(call);
    const r = answer(call);
    return r instanceof Response ? r : new Response(JSON.stringify(r), { status: 200, headers: { "content-type": "application/json" } });
  }) as unknown as typeof fetch;
  return { calls, provider: byteplusOn(fetchImpl) };
}
const refusal = (status: number, code: string, text: string) => new Response(JSON.stringify({ error: { code, message: text } }), { status });

test("the estimate is the documented price: 5 seconds of each model at each resolution, as BytePlus lists them", async () => {
  const { provider, calls } = fake(() => ({}));
  const price = (model: string, resolution: string) => provider.estimate(cfg(), spec({ model, resolution }));
  assert.deepEqual([await price(MINI, "480p"), await price(MINI, "720p")], [0.18, 0.38]);
  assert.deepEqual([await price(FAST, "480p"), await price(FAST, "720p")], [0.28, 0.6]);
  assert.deepEqual([await price(FULL, "480p"), await price(FULL, "720p"), await price(FULL, "1080p"), await price(FULL, "4k")], [0.35, 0.76, 1.87, 3.89]);
  assert.equal(await provider.estimate(cfg(), spec({ resolution: "480p", params: { duration: "10" } })), 0.35, "twice the seconds, twice the price");
  assert.equal(await provider.estimate(cfg(), spec()), 0.38, "no resolution named is 720p, what the API makes then");
  assert.deepEqual(calls, [], "an estimate asks BytePlus nothing and needs no key");
});

test("a task is sent with every value named, the key as a bearer token, and comes back as a queued job", async () => {
  const { provider, calls } = fake(() => ({ id: "cgt-20261119-abc" }));
  const job = await provider.start(cfg("SECRET"), spec({ resolution: "480p", aspect: "9:16", params: { duration: "4", seed: "7", generate_audio: "false" } }));
  assert.deepEqual(job, { id: "cgt-20261119-abc", status: "queued", resultUrl: null });
  assert.deepEqual(calls, [{
    method: "POST", url: TASKS, auth: "Bearer SECRET",
    body: { model: MINI, resolution: "480p", ratio: "9:16", duration: 4, seed: 7, generate_audio: false, content: [{ type: "text", text: "A cup of coffee on a desk, morning light" }] },
  }]);
});

test("images travel inside the task: a first frame, a last frame and references, each with its role", async () => {
  const dir = mkdtempSync(join(tmpdir(), "bw-byteplus-"));
  try {
    const first = join(dir, "first.png"), last = join(dir, "last.JPG"), ref = join(dir, "ref.webp");
    for (const f of [first, last, ref]) writeFileSync(f, Buffer.from([1, 2, 3]));
    const { provider, calls } = fake(() => ({ id: "cgt-1" }));
    await provider.start(cfg(), spec({ startImage: first, endImage: last, refs: [ref] }));
    assert.deepEqual(calls[0].body.content.slice(1), [
      { type: "image_url", image_url: { url: "data:image/png;base64,AQID" }, role: "first_frame" },
      { type: "image_url", image_url: { url: "data:image/jpeg;base64,AQID" }, role: "last_frame" },
      { type: "image_url", image_url: { url: "data:image/webp;base64,AQID" }, role: "reference_image" },
    ]);
    writeFileSync(join(dir, "clip.gif"), "x");
    await assert.rejects(provider.start(cfg(), spec({ refs: [join(dir, "clip.gif")] })), /takes PNG, JPEG or WebP images/);
    assert.equal(calls.length, 1, "a file it cannot take stops the task before it is sent");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("what the API would not take is refused before anything is sent or priced, with what to give instead", async () => {
  const { provider, calls } = fake(() => ({ id: "cgt-1" }));
  const cases: [Partial<GenSpec>, RegExp][] = [
    [{ model: "nano_banana_pro" }, /BytePlus has no model "nano_banana_pro" here\. Give one of dreamina-seedance-2-0-mini-260615, .* with --model/],
    [{ model: MINI, resolution: "1080p" }, /dreamina-seedance-2-0-mini-260615 makes 480p, 720p, not "1080p"/],
    [{ aspect: "4:5" }, /Seedance makes 16:9, 9:16, 1:1, 4:3, 3:4, 21:9, not "4:5"/],
    [{ params: { duration: "3" } }, /4 to 15 whole seconds, not "3"/],
    [{ params: { duration: "5.5" } }, /4 to 15 whole seconds/],
    [{ params: { seed: "-1" } }, /seed is a whole number/],
    [{ params: { quality: "high" } }, /takes the parameters duration, seed, generate_audio, watermark, camera_fixed, not "quality"/],
    [{ params: { watermark: "yes" } }, /watermark is true or false, not "yes"/],
    [{ videoRefs: ["/tmp/a.mp4"] }, /Video and audio references are not taken through BytePlus yet/],
  ];
  for (const [over, problem] of cases) {
    await assert.rejects(provider.estimate(cfg(), spec(over)), problem);
    await assert.rejects(provider.start(cfg(), spec(over)), problem);
  }
  assert.deepEqual(calls, []);
});

test("a task that is asked about: succeeded is a completed job with its video, the other states pass as they are and the failed ones count as failed", async () => {
  const states: Record<string, unknown> = {
    "cgt-done": { id: "cgt-done", status: "succeeded", content: { video_url: "https://cdn.example/v.mp4" }, usage: { completion_tokens: 50220 } },
    "cgt-run": { id: "cgt-run", status: "running" },
    "cgt-bad": { id: "cgt-bad", status: "failed", error: { code: "OutputVideoSensitiveContentDetected", message: "refused" } },
    "cgt-old": { id: "cgt-old", status: "expired" },
    "cgt-off": { id: "cgt-off", status: "cancelled" },
  };
  const { provider, calls } = fake((call) => states[call.url.split("/").at(-1)!]);
  assert.deepEqual(await provider.get(cfg(), "cgt-done"), { id: "cgt-done", status: "completed", resultUrl: "https://cdn.example/v.mp4" });
  assert.deepEqual(await provider.get(cfg(), "cgt-run"), { id: "cgt-run", status: "running", resultUrl: null });
  for (const id of ["cgt-bad", "cgt-old", "cgt-off"]) assert.ok(isFailed((await provider.get(cfg(), id)).status), id);
  assert.deepEqual([calls[0].method, calls[0].url, calls[0].auth], ["GET", `${TASKS}/cgt-done`, "Bearer KEY"]);
  await assert.rejects(provider.get(cfg(), "../models"), /is not a BytePlus task id/);
});

test("BytePlus's refusals are passed on with its code and words; a request that got no answer says that a task may have started", async () => {
  const closed = fake(() => refusal(404, "ModelNotOpen", "Your account has not activated the model dreamina-seedance-2-0-mini-260615."));
  await assert.rejects(closed.provider.start(cfg(), spec()), /^Error: BytePlus answered HTTP 404 \(ModelNotOpen\): Your account has not activated the model/);
  const silent = byteplusOn((async () => { throw new Error("socket hang up"); }) as unknown as typeof fetch);
  await assert.rejects(silent.start(cfg(), spec()), /BytePlus could not be reached \(socket hang up\)\. It is not known whether a task was started/);
});

test("status: without a key it says who sets one and how; a key is tried with one line of the task list, which spends nothing", async () => {
  const { provider, calls } = fake(() => ({ total: 3, items: [] }));
  const none = await provider.status(cfg(null));
  assert.equal(none.ok, false);
  assert.match(none.detail, /No BytePlus API key is set for this scope: a person makes the key in the BytePlus console/);
  assert.deepEqual(calls, [], "nothing is asked without a key");
  assert.deepEqual(await provider.status(cfg()), { ok: true, detail: "The API key is accepted (3 video tasks in the account)" });
  assert.deepEqual([calls[0].method, calls[0].url], ["GET", `${TASKS}?page_size=1`]);
  const wrong = fake(() => refusal(401, "AuthenticationError", "The API key is invalid."));
  assert.deepEqual(await wrong.provider.status(cfg("BAD")), { ok: false, detail: "BytePlus answered HTTP 401 (AuthenticationError): The API key is invalid." });
});

test("models: the list prices five seconds of each, one model says what it takes, and there is no image model", async () => {
  const { provider } = fake(() => ({}));
  const list = (await provider.models(cfg())).split("\n");
  assert.equal(list.length, 3);
  assert.match(list[0], /^dreamina-seedance-2-0-mini-260615  Seedance 2\.0 mini, the cheapest of the series\. 5 seconds cost about: 480p \$0\.18, 720p \$0\.38$/);
  const one = await provider.models(cfg(), { model: FULL });
  assert.match(one, /--resolution 480p \| 720p \| 1080p \| 4k \(720p when left out\)/);
  assert.match(one, /--duration 4 to 15 seconds/);
  assert.match(await provider.models(cfg(), { kind: "image" }), /no image model/);
  await assert.rejects(provider.models(cfg(), { model: "veo3_1" }), /BytePlus has no model "veo3_1" here/);
});
