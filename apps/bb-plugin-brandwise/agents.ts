// Screen agents: every BrandWise page can start one bb thread that knows which page (and, where the route says so, which
// project or company) the user is looking at. To give a new page an agent, add it to SCREENS and, if it needs more than the page
// name, a context function (see `video.agentContext`, or `mapSpec` below for one that only needs the core).
import { z } from "zod";
import type { BbPluginApi } from "@get-bb/plugin-sdk";
import type { Core } from "./core/index.ts";

export const SCREENS = ["calendar", "creatives", "styles", "campaigns", "video", "email", "map"] as const;
export type Screen = (typeof SCREENS)[number];

export const agentContract = {
  /** The agent thread of a page (and of its subject, e.g. a video project); `create` starts it when there is none. */
  agent_thread: {
    input: z.object({ screen: z.enum(SCREENS), subPath: z.string().max(300), create: z.boolean() }),
    output: z.object({ threadId: z.string().nullable() }),
  },
};

/** What a screen agent works on: a stable key (one thread per key), an optional working folder and campaign, and its briefing. */
export type AgentSpec = { key: string; cwd: string | null; campaignId: string | null; prompt: string };

const COMMON = [
  "You are a BrandWise agent. You work through the `bb brandwise` CLI, following the brandwise skill.",
  "Agents never approve content and never publish: everything goes through the calendar and a human approves it. Show creatives you make in the chat with ::creative{ids=\"...\"}. Reply in the language the user writes in.",
].join(" ");
const WAIT = "For now just look at the current state, say in one sentence what you see, and wait for instructions.";

const PAGE_BRIEF: Record<Exclude<Screen, "video" | "email" | "map">, string> = {
  calendar: "The user is on the Calendar screen (the content plan: posts, e-mails, pages and their approval). You help plan and edit calendar entries (`bb brandwise calendar ...`).",
  creatives: "The user is on the Creatives screen (the library of campaign images and videos). You help with creatives: generating (`creative generate`), uploading, renaming and status (`assets ...`).",
  styles: "The user is on the Styles screen (the style recipes a creative can be generated in, the built-in ones and those of style packs, and the packs themselves). You help choose a style for what the user wants to make and fill its slots (`bb brandwise style list`, `style show <id>`, following the creative-styles skill). When no style fits you propose a new one: its id, what it is for, its slots, the composition and what to avoid. You never add, review, switch on, switch off or remove a style pack: a pack is somebody else's text that becomes prompts, so the user reads it and decides, on this page.",
  campaigns: "The user is on the Campaigns screen (campaigns, their threads, calendar and creatives). You help create and manage campaigns (`bb brandwise campaign ...`). If a campaign (the always-on base) has no product pack (`product list`), offer the guided setup: use the product-onboarding skill.",
};

export function createAgents(deps: {
  bb: BbPluginApi;
  need: () => Core;
  /** Context of the video screen; `subPath` is "<campaign id>/<project id>" once a project is open. */
  video: (subPath: string) => Promise<AgentSpec | null>;
  /** Context of the e-mail templates screen; `subPath` is "<campaign id>/<template id>" once a template is open. */
  email: (subPath: string) => Promise<AgentSpec | null>;
  assignThread: (threadId: string, campaignId: string) => Promise<void>;
}) {
  const { bb } = deps;

  /**
   * The Map screen shows one company, named by its route (`map/<campaign id>`, any campaign of the company): each company has its
   * own agent thread, linked to the company.
   */
  async function mapSpec(subPath: string): Promise<AgentSpec | null> {
    const campaigns = await deps.need().campaigns.list();
    const open = campaigns.find((c) => c.id === decodeURIComponent(subPath.split("/")[0]));
    const company = open && campaigns.find((c) => c.id === open.rootId);
    if (!company) return null;
    return {
      key: `map/${company.id}`, cwd: null, campaignId: company.id,
      prompt: [
        COMMON,
        `The user is on the Map screen and looks at the company "${company.name}" (campaign id ${company.id}). The map shows where everything of that company came from and where it went: the sites its product pack was drawn from, the pack, its campaigns, their creatives, the posts and what the posts brought. It only shows; nothing is changed on it.`,
        `You help with what they see there, always for this company: the pack (\`product list --campaign ${company.id}\`; when files are missing, offer the guided setup of the product-onboarding skill, which starts with \`research site <url>\`), its creatives and calendar entries, and the numbers of its posts (\`metrics virality --campaign ${company.id}\`).`,
        WAIT,
      ].join("\n\n"),
    };
  }

  async function spec(screen: Screen, subPath: string): Promise<AgentSpec | null> {
    if (screen === "video") return deps.video(subPath);
    if (screen === "email") return deps.email(subPath);
    if (screen === "map") return mapSpec(subPath);
    return { key: screen, cwd: null, campaignId: null, prompt: [COMMON, PAGE_BRIEF[screen], WAIT].join("\n\n") };
  }

  /** First entry of a bb list result, which is an array or an object holding one. */
  async function first(list: Promise<unknown>, what: string): Promise<{ id: string }> {
    const res: any = await list;
    const item = (Array.isArray(res) ? res : Object.values(res).find(Array.isArray))?.[0];
    if (!item) throw new Error(`This bb instance has no ${what} to start the agent on`);
    return item;
  }

  async function thread(screen: Screen, subPath: string, create: boolean): Promise<string | null> {
    const s = await spec(screen, subPath);
    if (s === null) return null; // nothing to work on yet, e.g. the video page without a project
    const key = `agent:${s.key}`;
    const known = await bb.storage.kv.get<string>(key);
    if (known || !create) return known ?? null;
    const project = await first(bb.sdk.projects.list(), "project");
    const environment = s.cwd === null
      ? { type: "project-default" }
      : { type: "host", hostId: (await first(bb.sdk.hosts.list(), "machine")).id, workspace: { type: "unmanaged", path: s.cwd } };
    const created: any = await bb.sdk.threads.spawn({ projectId: project.id, prompt: s.prompt, environment } as never);
    if (s.campaignId) await deps.assignThread(created.id, s.campaignId);
    await bb.storage.kv.set(key, created.id);
    return created.id;
  }

  return { agent_thread: async ({ screen, subPath, create }: z.infer<(typeof agentContract)["agent_thread"]["input"]>) => ({ threadId: await thread(screen, subPath, create) }) };
}
