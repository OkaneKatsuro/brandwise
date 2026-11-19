// BytePlus ModelArk: ByteDance's own API for its Seedance video models (docs.byteplus.com/en/docs/ModelArk), over plain HTTPS with an
// API key. A task is created and then asked about until it has a video; the video's address lasts 24 hours, so it is downloaded when
// the task is collected. Costs are in US dollars and are worked out before anything is spent, from the documented token formula.
import { readFile } from "node:fs/promises";
import { extname } from "node:path";
import type { Auth, GenSpec, Job, Provider, ProviderConfig } from "./index.ts";

const TASKS = "https://ark.ap-southeast.bytepluses.com/api/v3/contents/generations/tasks";

/** The Seedance 2.0 series as BytePlus sells it: US dollars per million tokens by output resolution, for input without video. */
const MODELS: Record<string, { about: string; price: Record<string, number> }> = {
  "dreamina-seedance-2-0-mini-260615": { about: "Seedance 2.0 mini, the cheapest of the series", price: { "480p": 3.5, "720p": 3.5 } },
  "dreamina-seedance-2-0-fast-260128": { about: "Seedance 2.0 fast, quicker and cheaper than 2.0", price: { "480p": 5.6, "720p": 5.6 } },
  "dreamina-seedance-2-0-260128": { about: "Seedance 2.0, the best quality of the series", price: { "480p": 7, "720p": 7, "1080p": 7.7, "4k": 4 } },
};
/** Pixels of one frame by resolution, as the documented prices of 16:9 videos imply; the other ratios have about as many. */
const PIXELS: Record<string, number> = { "480p": 864 * 496, "720p": 1280 * 720, "1080p": 1920 * 1080, "4k": 3840 * 2160 };
const FRAMES_PER_SECOND = 24;
const RATIOS = ["16:9", "9:16", "1:1", "4:3", "3:4", "21:9"];
const SECONDS = { min: 4, max: 15, standard: 5 };
/** What the API itself makes when a task names no resolution. Named in every task, so that what is priced is what is made. */
const STANDARD_RESOLUTION = "720p";
/** Parameters that are yes or no. */
const SWITCHES = ["generate_audio", "watermark", "camera_fixed"];
/** An image travels inside the request, so it is kept small. */
const IMAGE_TYPES: Record<string, string> = { ".png": "image/png", ".jpg": "image/jpeg", ".jpeg": "image/jpeg", ".webp": "image/webp" };
const MAX_IMAGE_BYTES = 10_000_000;
const TASK_ID = /^[A-Za-z0-9-]{1,80}$/;

const NO_KEY = "No BytePlus API key is set for this scope";
const message = (cause: unknown) => (cause instanceof Error ? cause.message : String(cause));

/** The task as the API takes it, without its content. Everything is checked here, before a request is made or priced. */
function taskOf(spec: GenSpec) {
  const model = MODELS[spec.model];
  if (!model) throw new Error(`BytePlus has no model "${spec.model}" here. Give one of ${Object.keys(MODELS).join(", ")} with --model (bb brandwise creative models)`);
  const resolution = spec.resolution ?? STANDARD_RESOLUTION;
  if (!(resolution in model.price)) throw new Error(`${spec.model} makes ${Object.keys(model.price).join(", ")}, not "${resolution}": give one of those with --resolution`);
  const ratio = spec.aspect ?? RATIOS[0];
  if (!RATIOS.includes(ratio)) throw new Error(`Seedance makes ${RATIOS.join(", ")}, not "${ratio}": give one of those with --aspect`);
  const { duration: seconds, seed, ...switches } = spec.params ?? {};
  const duration = seconds === undefined ? SECONDS.standard : Number(seconds);
  if (!Number.isInteger(duration) || duration < SECONDS.min || duration > SECONDS.max) throw new Error(`Seedance makes ${SECONDS.min} to ${SECONDS.max} whole seconds, not "${seconds}": give that with --duration`);
  if (seed !== undefined && !/^\d{1,9}$/.test(seed)) throw new Error(`seed is a whole number of at most nine digits, not "${seed}"`);
  for (const [name, value] of Object.entries(switches)) {
    if (!SWITCHES.includes(name)) throw new Error(`BytePlus takes the parameters duration, seed, ${SWITCHES.join(", ")}, not "${name}"`);
    if (value !== "true" && value !== "false") throw new Error(`${name} is true or false, not "${value}"`);
  }
  if ((spec.videoRefs ?? []).length > 0 || (spec.audioRefs ?? []).length > 0) throw new Error("Video and audio references are not taken through BytePlus yet: it wants them at a public address and prices them differently");
  return {
    model: spec.model, resolution, ratio, duration, ...(seed === undefined ? {} : { seed: Number(seed) }),
    ...Object.fromEntries(Object.entries(switches).map(([name, value]) => [name, value === "true"])),
  };
}

/**
 * What a task costs, in US dollars: tokens = pixels of a frame x frames per second x seconds / 1024, at the model's price per
 * million tokens for that resolution. An estimate, as BytePlus says of its own: the bill is by the tokens the finished task reports.
 */
const priceOf = (task: ReturnType<typeof taskOf>) =>
  Math.round(((PIXELS[task.resolution] * FRAMES_PER_SECOND * task.duration) / 1024 / 1_000_000) * MODELS[task.model].price[task.resolution] * 100) / 100;

async function imageItem(file: string, role: string) {
  const type = IMAGE_TYPES[extname(file).toLowerCase()];
  if (!type) throw new Error(`BytePlus takes PNG, JPEG or WebP images, not ${file}`);
  const bytes = await readFile(file);
  if (bytes.length > MAX_IMAGE_BYTES) throw new Error(`${file} is over ${MAX_IMAGE_BYTES / 1_000_000} MB: an image travels inside the request, give a smaller one`);
  return { type: "image_url", image_url: { url: `data:${type};base64,${bytes.toString("base64")}` }, role };
}

/** The prompt and the images of a task: a first and a last frame, or reference images the video keeps to. */
const contentOf = async (spec: GenSpec) => [
  { type: "text", text: spec.prompt },
  ...(spec.startImage ? [await imageItem(spec.startImage, "first_frame")] : []),
  ...(spec.endImage ? [await imageItem(spec.endImage, "last_frame")] : []),
  ...(await Promise.all((spec.refs ?? []).map((file) => imageItem(file, "reference_image")))),
];

const jobFrom = (task: any): Job => {
  if (typeof task?.id !== "string") throw new Error(`Unexpected answer from BytePlus: ${JSON.stringify(task).slice(0, 160)}`);
  const video = task.content?.video_url;
  // the caller's word for a finished job is "completed"; the other states (queued, running, failed, cancelled, expired) pass as they are
  return { id: task.id, status: task.status === "succeeded" ? "completed" : String(task.status ?? "queued"), resultUrl: typeof video === "string" ? video : null };
};

/** The provider on a given `fetch`; tests hand in their own. */
export function byteplusOn(fetchImpl: typeof fetch): Provider {
  const hint = "a person makes the key in the BytePlus console (ModelArk > API keys) and sets it under Settings > Providers > BytePlus, or as BYTEPLUS_API_KEY in .env followed by infra/bb-instance/provision.sh apply";
  /** One request with the scope's key. An answer that is not a success becomes an error with BytePlus's own code and words. */
  async function call(cfg: ProviderConfig, method: "GET" | "POST", url: string, body?: unknown): Promise<any> {
    const key = String(cfg.values.apiKey ?? "");
    if (key === "") throw new Error(`${NO_KEY}: ${hint}`);
    const res = await fetchImpl(url, {
      method, headers: { authorization: `Bearer ${key}`, "content-type": "application/json" },
      body: body === undefined ? undefined : JSON.stringify(body), signal: AbortSignal.timeout(60_000),
    });
    const text = await res.text();
    let json: any = null;
    try { json = JSON.parse(text); } catch { /* an answer that is not JSON is reported as it came */ }
    if (!res.ok) throw new Error(`BytePlus answered HTTP ${res.status}${json?.error?.code ? ` (${json.error.code})` : ""}: ${String(json?.error?.message ?? text).slice(0, 300)}`);
    return json;
  }
  return {
    id: "byteplus",
    label: "BytePlus",
    unit: "usd",
    defaultModel: "dreamina-seedance-2-0-mini-260615",
    budget: { perGeneration: 1, daily: 5 },
    fields: [
      {
        key: "apiKey", label: "API key", type: "string", secret: true,
        description: "The key of the BytePlus account this scope generates with (console: ModelArk > API keys). The Seedance models must be activated in that account. Only the user sets this.",
      },
    ],
    async status(cfg): Promise<Auth> {
      try {
        // the cheapest request the key is needed for: one line of the account's task list
        const tasks = await call(cfg, "GET", `${TASKS}?page_size=1`);
        return { ok: true, detail: `The API key is accepted (${Number(tasks?.total ?? 0)} video tasks in the account)` };
      } catch (cause) {
        return { ok: false, detail: message(cause) };
      }
    },
    loginHint: () => hint,
    async models(_cfg, query) {
      if (query?.kind === "image") return "BytePlus is set up for video here (Seedance); it has no image model.";
      const line = (id: string) => {
        const m = MODELS[id];
        const prices = Object.keys(m.price).map((resolution) => `${resolution} $${priceOf({ model: id, resolution, ratio: RATIOS[0], duration: SECONDS.standard }).toFixed(2)}`);
        return `${id}  ${m.about}. ${SECONDS.standard} seconds cost about: ${prices.join(", ")}`;
      };
      if (query?.model === undefined) return Object.keys(MODELS).map(line).join("\n");
      if (!MODELS[query.model]) throw new Error(`BytePlus has no model "${query.model}" here. Its models: ${Object.keys(MODELS).join(", ")}`);
      return [
        line(query.model),
        `--resolution ${Object.keys(MODELS[query.model].price).join(" | ")} (${STANDARD_RESOLUTION} when left out)`,
        `--aspect ${RATIOS.join(" | ")} (${RATIOS[0]} when left out)`,
        `--duration ${SECONDS.min} to ${SECONDS.max} seconds (${SECONDS.standard} when left out); the price grows with the seconds`,
        `--param seed=<number>, and ${SWITCHES.map((s) => `--param ${s}=true|false`).join(", ")} (sound is generated unless generate_audio=false)`,
        "--start-image and --end-image set the first and the last frame, --ref gives reference images (PNG, JPEG or WebP); video and audio references are not taken yet",
      ].join("\n");
    },
    async estimate(_cfg, spec) {
      return priceOf(taskOf(spec));
    },
    async start(cfg, spec) {
      const task = { ...taskOf(spec), content: await contentOf(spec) };
      try {
        return jobFrom(await call(cfg, "POST", TASKS, task));
      } catch (cause) {
        // an answer from BytePlus says that nothing was started; without one (a timeout, a dropped connection) nobody knows
        if (message(cause).startsWith("BytePlus answered") || message(cause).startsWith(NO_KEY)) throw cause;
        throw new Error(`BytePlus could not be reached (${message(cause)}). It is not known whether a task was started: look at the task list in the BytePlus console before trying again.`);
      }
    },
    async get(cfg, jobId) {
      if (!TASK_ID.test(jobId)) throw new Error(`"${jobId}" is not a BytePlus task id`);
      return jobFrom(await call(cfg, "GET", `${TASKS}/${jobId}`));
    },
  };
}

export const byteplus = byteplusOn(fetch);
