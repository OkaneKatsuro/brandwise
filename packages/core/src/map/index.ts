// The company map read from Postgres: everything of one company, from the sites its pack was drawn from to what its posts brought,
// in one call (docs/map.md). The reads are bounded, so a company with years of posts gives a map of the same size; what is left out
// is counted. Which rows become which nodes and edges is domain.ts.
import type pg from "pg";
import type { Context } from "../context/index.ts";
import type { Campaign } from "../index.ts";
import type { EntryRef, Metrics } from "../metrics/index.ts";
import { VERDICT_AGE } from "../metrics/virality.ts";
import { companyMap, packFile, POSTS_SHOWN, UNUSED_CREATIVES_SHOWN, type CompanyMap, type MapParts, type PostDetails } from "./domain.ts";

export * from "./domain.ts";

/** The metrics service, as far as the map reads it. The shell builds that service, with the sources it holds the keys of, so a read is handed it. */
type Results = Pick<Metrics, "forEntries" | "virality">;
/** A post as it is read: what the map shows of it, and what a metrics source finds its numbers by. */
type Entry = MapParts["posts"][number] & Pick<EntryRef, "externalId" | "externalUrl">;

export function createMap(deps: {
  pool: pg.Pool;
  /** `campaigns` of the core. */
  campaigns: { list(): Promise<Campaign[]> };
  /** `context` of the core: the pack and the sites it was drawn from. */
  context: Pick<Context, "list" | "sources" | "asOf">;
}) {
  const q = async (sql: string, params: unknown[] = []) => (await deps.pool.query(sql, params)).rows;

  /**
   * What the shown posts brought: one result per published post whose views or clicks some source measured, as of `asOf`. The
   * numbers of all of them are read in one call and virality is asked once, for exactly these entries: each is judged against
   * its company, so neither needs a read per entry here.
   */
  async function resultsOf(root: Campaign, entries: Entry[], metrics: Results, asOf: Date): Promise<MapParts["results"]> {
    const numbers = await metrics.forEntries(entries.filter((e) => e.status === "published"), asOf);
    const measured = numbers.filter((n) => n.values.exposures !== undefined || n.values.clicks !== undefined);
    if (measured.length === 0) return [];
    const judged = new Map((await metrics.virality(root, asOf, { entryIds: measured.map((n) => n.entryId) })).map((v) => [v.entryId, v]));
    return measured.map((n) => {
      // an entry that had not reached its audience by `asOf` is not judged at all: its verdict is unknown, like that of one too young
      const v = judged.get(n.entryId);
      return { entryId: n.entryId, exposures: n.values.exposures ?? null, clicks: n.values.clicks ?? null, verdict: v?.verdict ?? "unknown", ratio: v?.ages[VERDICT_AGE].ratio ?? null };
    });
  }

  return {
    /**
     * The map of the company `campaignId` belongs to (the always-on base at its root, whichever campaign is asked for), with its
     * results as of `asOf`. Shown are the newest POSTS_SHOWN posts by their time, the creatives those use and the newest
     * UNUSED_CREATIVES_SHOWN creatives no post of the company uses; each campaign says how many of its posts and creatives that
     * leaves out.
     */
    async company(campaignId: string, metrics: Results, asOf: Date): Promise<CompanyMap> {
      const all = await deps.campaigns.list();
      const asked = all.find((c) => c.id === campaignId);
      if (!asked) throw new Error(`No campaign with id ${campaignId}`);
      const root = all.find((c) => c.id === asked.rootId)!;
      const campaigns = all.filter((c) => c.rootId === root.id), ids = campaigns.map((c) => c.id);

      const [sources, pack, rows, totals] = await Promise.all([
        deps.context.sources(root.id),
        deps.context.list(root.id),
        q(`select id, campaign_id, title, channel, status, scheduled_at, asset_id, external_id, external_url from content_calendar
           where campaign_id = any($1::uuid[]) order by scheduled_at desc, id limit $2`, [ids, POSTS_SHOWN]),
        q(`select campaign_id, sum(creatives) as creatives, sum(posts) as posts from (
             select campaign_id, 1 as creatives, 0 as posts from asset where role = 'creative' and campaign_id = any($1::uuid[])
             union all select campaign_id, 0, 1 from content_calendar where campaign_id = any($1::uuid[])) n
           group by campaign_id`, [ids]),
      ]);
      const entries: Entry[] = rows.map((r: any) => ({
        id: r.id, campaignId: r.campaign_id, title: r.title, channel: r.channel, status: r.status, scheduledAt: new Date(r.scheduled_at).toISOString(),
        assetId: r.asset_id, externalId: r.external_id, externalUrl: r.external_url,
      }));
      const assets = await q(
        `select id, campaign_id, name, kind, provenance #>> '{style,id}' as style, provenance ->> 'prompt' as prompt from asset
         where role = 'creative' and campaign_id = any($1::uuid[]) and (id = any($2::uuid[]) or id in (
           select u.id from asset u where u.role = 'creative' and u.campaign_id = any($1::uuid[])
             and not exists (select 1 from content_calendar c where c.asset_id = u.id and c.campaign_id = any($1::uuid[]))
           order by u.created_at desc, u.id limit $3))
         order by created_at desc, id`,
        [ids, entries.flatMap((e) => (e.assetId === null ? [] : [e.assetId])), UNUSED_CREATIVES_SHOWN],
      );
      const derived = await q("select parent_id, child_id from asset_link where relation = 'derived_from' and parent_id = any($1::uuid[]) and child_id = any($1::uuid[])", [assets.map((r: any) => r.id)]);

      return companyMap({
        rootId: root.id, sources, pack, campaigns, posts: entries,
        creatives: assets.map((r: any) => ({ id: r.id, campaignId: r.campaign_id, name: r.name, kind: r.kind, style: r.style, prompt: r.prompt })),
        derived: derived.map((r: any) => ({ parentId: r.parent_id, childId: r.child_id })),
        results: await resultsOf(root, entries, metrics, asOf),
        totals: totals.map((r: any) => ({ campaignId: r.campaign_id, creatives: Number(r.creatives), posts: Number(r.posts) })),
      });
    },
    /**
     * What the map does not carry of a post: its text, and the pack it was written from, which is the pack as it stood at the
     * moment the entry was created.
     */
    async post(entryId: string): Promise<PostDetails> {
      const row = (await q("select campaign_id, body, created_at from content_calendar where id = $1", [entryId]))[0];
      if (!row) throw new Error(`No calendar entry with id ${entryId}`);
      return { entryId, text: row.body, pack: (await deps.context.asOf(row.campaign_id, new Date(row.created_at))).map(packFile) };
    },
  };
}
