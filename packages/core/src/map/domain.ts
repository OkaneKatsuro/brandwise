// The company map: where everything of one company came from and where it went, as nodes in six columns and the edges between them
// (docs/map.md). Pure: no database. What a node of each column says, which links become edges, the order within a column and the
// chain of a node. The map is a view: positions in pixels are the business of whoever draws it, and nothing here can be changed.
import type { DocVersion, SiteSource } from "../context/index.ts";
import type { Campaign, Status } from "../index.ts";
import type { Verdict } from "../metrics/virality.ts";

/** The columns, left to right: from what the company's context was read from to what its posts brought. */
export const COLUMNS = ["source", "pack", "campaign", "creative", "post", "result"] as const;
export type Column = (typeof COLUMNS)[number];

/** The map shows this many posts, the newest; the older ones are counted per campaign. */
export const POSTS_SHOWN = 40;
/** Beside the creatives its posts use, the map shows this many of the creatives no post uses, the newest. */
export const UNUSED_CREATIVES_SHOWN = 20;

/** A file of the pack as the map shows it: which version, and whether a person had confirmed that version. */
export type PackFile = { name: string; version: number; confirmed: boolean };
export const packFile = (v: DocVersion): PackFile => ({ name: v.name, version: v.version, confirmed: v.confirmedAt !== null });

/** What every node has: an id that stays the same from one read to the next, its column and its place in it, counted from the top. */
type Placed<C extends Column> = { id: string; column: C; order: number };
/** A site the pack was drawn from, as of its latest read. */
export type SourceNode = Placed<"source"> & { site: string; readAt: string; pages: number };
/** The company's pack, one node whatever it holds: the current version of each file, and which of the five files it lacks. */
export type PackNode = Placed<"pack"> & { files: PackFile[]; missing: string[] };
/** The company or a campaign under it. `hidden` is what the map leaves out of it: creatives and posts older than the ones shown. */
export type CampaignNode = Placed<"campaign"> & { campaignId: string; name: string; kind: Campaign["kind"]; hidden: { creatives: number; posts: number } };
/** A creative; `style` is the recipe it was generated from and `prompt` what the provider was asked, when its provenance says so. */
export type CreativeNode = Placed<"creative"> & { assetId: string; campaignId: string; name: string; kind: string; style: string | null; prompt: string | null };
export type PostNode = Placed<"post"> & { entryId: string; campaignId: string; title: string; channel: string; status: Status; scheduledAt: string };
/** What a published post brought. A number no source measured is null, never zero; `ratio` is the one the verdict was taken from. */
export type ResultNode = Placed<"result"> & { entryId: string; exposures: number | null; clicks: number | null; verdict: Verdict; ratio: number | null };
export type MapNode = SourceNode | PackNode | CampaignNode | CreativeNode | PostNode | ResultNode;
/** `to` came from `from`. */
export type MapEdge = { from: string; to: string };
export type CompanyMap = { rootId: string; nodes: MapNode[]; edges: MapEdge[] };

/** What the map does not carry of a post: its text, and the pack as it stood when the entry was created. */
export type PostDetails = { entryId: string; text: string; pack: PackFile[] };

/** What was read of a company: the rows a map is drawn from, each list in the order its column shows it. */
export type MapParts = {
  rootId: string;
  /** The sites read for the pack, the one read last first. */
  sources: SiteSource[];
  pack: { files: DocVersion[]; missing: string[] };
  /** The company and every campaign under it, in the order they were created. */
  campaigns: Campaign[];
  /** The creatives shown, newest first. */
  creatives: { id: string; campaignId: string; name: string; kind: string; style: string | null; prompt: string | null }[];
  /** `childId` was derived from `parentId`. */
  derived: { parentId: string; childId: string }[];
  /** The posts shown, newest first. */
  posts: { id: string; campaignId: string; title: string; channel: string; status: Status; scheduledAt: string; assetId: string | null }[];
  results: { entryId: string; exposures: number | null; clicks: number | null; verdict: Verdict; ratio: number | null }[];
  /** How many creatives and posts each campaign has in all, shown or not; a campaign without any is left out. */
  totals: { campaignId: string; creatives: number; posts: number }[];
};

const ID = {
  source: (site: string) => `source:${site}`,
  pack: "pack",
  campaign: (id: string) => `campaign:${id}`,
  creative: (assetId: string) => `creative:${assetId}`,
  post: (entryId: string) => `post:${entryId}`,
  result: (entryId: string) => `result:${entryId}`,
};

/** The company first, each campaign followed by the campaigns under it. */
function familyOrder(campaigns: readonly Campaign[], rootId: string): Campaign[] {
  const under = (parentId: string): Campaign[] => campaigns.filter((c) => c.parentId === parentId).flatMap((c) => [c, ...under(c.id)]);
  return [...campaigns.filter((c) => c.id === rootId), ...under(rootId)];
}

/**
 * The map of a company. An edge is drawn only where the data records the link: a site was read for the pack, the pack is the
 * company's, a campaign has a parent, a creative belongs to a campaign or was derived from another creative, a post uses a
 * creative, a result is a post's. A post with no creative on the map (it has none, or uses an asset that is not a creative of the
 * company) hangs on its own campaign instead, and an empty pack feeds nothing. A link to something the map does not show is left
 * out, so every edge joins two nodes.
 */
export function companyMap(parts: MapParts): CompanyMap {
  const place = <N extends { id: string }>(nodes: N[]) => nodes.map((n, order) => ({ ...n, order }));
  const total = new Map(parts.totals.map((t) => [t.campaignId, t]));
  // the rows and the totals are read one after the other, so a row added in between is shown before it is counted: never below zero
  const leftOut = (all: number | undefined, rows: readonly { campaignId: string }[], campaignId: string) => Math.max(0, (all ?? 0) - rows.filter((r) => r.campaignId === campaignId).length);

  const sources: SourceNode[] = place(parts.sources.map((s) => ({ id: ID.source(s.site), column: "source" as const, site: s.site, readAt: s.readAt, pages: s.pages })));
  const pack: PackNode = { id: ID.pack, column: "pack", order: 0, files: parts.pack.files.map(packFile), missing: parts.pack.missing };
  const campaigns: CampaignNode[] = place(familyOrder(parts.campaigns, parts.rootId).map((c) => ({
    id: ID.campaign(c.id), column: "campaign" as const, campaignId: c.id, name: c.name, kind: c.kind,
    hidden: { creatives: leftOut(total.get(c.id)?.creatives, parts.creatives, c.id), posts: leftOut(total.get(c.id)?.posts, parts.posts, c.id) },
  })));
  const creatives: CreativeNode[] = place(parts.creatives.map((a) => ({ id: ID.creative(a.id), column: "creative" as const, assetId: a.id, campaignId: a.campaignId, name: a.name, kind: a.kind, style: a.style, prompt: a.prompt })));
  const posts: PostNode[] = place(parts.posts.map((e) => ({ id: ID.post(e.id), column: "post" as const, entryId: e.id, campaignId: e.campaignId, title: e.title, channel: e.channel, status: e.status, scheduledAt: e.scheduledAt })));
  const measured = new Map(parts.results.map((r) => [r.entryId, r]));
  const results: ResultNode[] = place(parts.posts.flatMap((e) => {
    const r = measured.get(e.id);
    return r ? [{ id: ID.result(e.id), column: "result" as const, entryId: e.id, exposures: r.exposures, clicks: r.clicks, verdict: r.verdict, ratio: r.ratio }] : [];
  }));

  const nodes: MapNode[] = [...sources, pack, ...campaigns, ...creatives, ...posts, ...results];
  const onMap = new Set(nodes.map((n) => n.id));
  const edges: MapEdge[] = [
    ...sources.map((s) => ({ from: s.id, to: pack.id })),
    ...(pack.files.length > 0 ? [{ from: pack.id, to: ID.campaign(parts.rootId) }] : []),
    ...parts.campaigns.flatMap((c) => (c.parentId === null ? [] : [{ from: ID.campaign(c.parentId), to: ID.campaign(c.id) }])),
    ...parts.creatives.map((a) => ({ from: ID.campaign(a.campaignId), to: ID.creative(a.id) })),
    ...parts.derived.map((l) => ({ from: ID.creative(l.parentId), to: ID.creative(l.childId) })),
    ...parts.posts.map((e) => ({ from: e.assetId !== null && onMap.has(ID.creative(e.assetId)) ? ID.creative(e.assetId) : ID.campaign(e.campaignId), to: ID.post(e.id) })),
    ...results.map((r) => ({ from: ID.post(r.entryId), to: r.id })),
  ].filter((e) => onMap.has(e.from) && onMap.has(e.to));
  return { rootId: parts.rootId, nodes, edges };
}

/**
 * The chain of a node, for the highlight: every node it came from (`upstream`, against the edges) and every node that came from it
 * (`downstream`, along them), however many steps away, each in the order of `nodes`. A node that is not on the map has no chain.
 */
export function chain(nodes: readonly { id: string }[], edges: readonly MapEdge[], id: string): { upstream: string[]; downstream: string[] } {
  const reach = (next: (e: MapEdge) => [at: string, to: string]): string[] => {
    const seen = new Set([id]);
    // a set is walked in the order it grows, so nodes found on the way are visited too; one already seen is not added again,
    // which is what ends the walk where links run in a circle
    for (const at of seen) for (const e of edges) { const [here, there] = next(e); if (here === at) seen.add(there); }
    return nodes.filter((n) => n.id !== id && seen.has(n.id)).map((n) => n.id);
  };
  if (!nodes.some((n) => n.id === id)) return { upstream: [], downstream: [] };
  return { upstream: reach((e) => [e.to, e.from]), downstream: reach((e) => [e.from, e.to]) };
}
