// The Map page's server side: the company map and a post's details over RPC. What is on the map, its bounds and its edges live in
// packages/core/src/map; this file declares the contract, adds the address of each creative's thumbnail and calls the core.
import { z } from "zod";
import { STATUSES, type Core } from "./core/index.ts";
import type { Metrics } from "./core/metrics/index.ts";
import { VERDICTS } from "./core/metrics/virality.ts";

const packFile = z.object({ name: z.string(), version: z.number(), confirmed: z.boolean() });
const placed = { id: z.string(), order: z.number() };
const node = z.discriminatedUnion("column", [
  z.object({ ...placed, column: z.literal("source"), site: z.string(), readAt: z.string(), pages: z.number() }),
  z.object({ ...placed, column: z.literal("pack"), files: z.array(packFile), missing: z.array(z.string()) }),
  z.object({ ...placed, column: z.literal("campaign"), campaignId: z.string(), name: z.string(), kind: z.enum(["always_on", "campaign"]), hidden: z.object({ creatives: z.number(), posts: z.number() }) }),
  z.object({ ...placed, column: z.literal("creative"), assetId: z.string(), campaignId: z.string(), name: z.string(), kind: z.string(), style: z.string().nullable(), prompt: z.string().nullable(), thumb: z.string() }),
  z.object({ ...placed, column: z.literal("post"), entryId: z.string(), campaignId: z.string(), title: z.string(), channel: z.string(), status: z.enum(STATUSES), scheduledAt: z.string() }),
  z.object({ ...placed, column: z.literal("result"), entryId: z.string(), exposures: z.number().nullable(), clicks: z.number().nullable(), verdict: z.enum(VERDICTS), ratio: z.number().nullable() }),
]);
const companyMap = z.object({ rootId: z.string(), nodes: z.array(node), edges: z.array(z.object({ from: z.string(), to: z.string() })) });
const postDetails = z.object({ entryId: z.string(), text: z.string(), pack: z.array(packFile) });
export type CompanyMapView = z.infer<typeof companyMap>;
export type MapNodeView = z.infer<typeof node>;
export type PostDetailsView = z.infer<typeof postDetails>;

export const mapContract = {
  /** The map of the company a campaign belongs to: nodes in columns and the edges between them, bounded (docs/map.md). */
  map_company: { input: z.object({ campaignId: z.string() }), output: companyMap },
  /** What the map does not carry of a post: its text and the pack versions in force when it was created. */
  map_post: { input: z.object({ entryId: z.string() }), output: postDetails },
};
type In<K extends keyof typeof mapContract> = z.infer<(typeof mapContract)[K]["input"]>;

export function createMapRpc(deps: { need: () => Core; metrics: () => Metrics | null; now: () => Promise<Date>; thumbUrl: (assetId: string) => string }) {
  return {
    map_company: async ({ campaignId }: In<"map_company">): Promise<CompanyMapView> => {
      const core = deps.need(), metrics = deps.metrics();
      if (!metrics) throw new Error("The map's results need the metrics service, which starts with the database: run infra/bb-instance/provision.sh apply");
      const map = await core.map.company(campaignId, metrics, await deps.now());
      return { ...map, nodes: map.nodes.map((n) => (n.column === "creative" ? { ...n, thumb: deps.thumbUrl(n.assetId) } : n)) };
    },
    map_post: async ({ entryId }: In<"map_post">) => deps.need().map.post(entryId),
  };
}
