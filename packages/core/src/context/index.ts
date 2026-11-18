// The company's context in Postgres: the pack of an always-on base as versioned Markdown files, the same on every machine. Versions
// are only added (the newest of a name is the current one), each records who wrote it, and a person confirms the current one. The
// CLI and later the pages read the pack from here, never from a disk.
import { readdir, readFile, stat } from "node:fs/promises";
import { join } from "node:path";
import type pg from "pg";
import { bodyProblem, missingFiles, nameProblem, stored, type Doc, type DocVersion } from "./domain.ts";

export type { DocVersion } from "./domain.ts";

/** What an import did with one pack folder: files added as version 1, files the database already had, files it could not take. */
type ImportedPack = { campaignId: string; campaignName: string; added: string[]; kept: string[]; skipped: { name: string; reason: string }[] };

type Query = (sql: string, params?: unknown[]) => Promise<any[]>;

const META = "name, version, author, created_at, confirmed_at, confirmed_by";
const versionFrom = (r: any): DocVersion => ({
  name: r.name, version: r.version, author: r.author, createdAt: new Date(r.created_at).toISOString(),
  confirmedAt: r.confirmed_at ? new Date(r.confirmed_at).toISOString() : null, confirmedBy: r.confirmed_by,
});
const refuse = (problem: string | null) => { if (problem) throw new Error(problem); };

export function createContext(deps: { pool: pg.Pool }) {
  const q: Query = async (sql, params = []) => (await deps.pool.query(sql, params)).rows;

  /** The pack belongs to the always-on base: a campaign under it reads and writes its base's pack. */
  const packOf = async (campaignId: string): Promise<string> => {
    const row = (await q("select coalesce(parent_id, id) as id from campaign where id = $1", [campaignId]))[0];
    if (!row) throw new Error(`No campaign with id ${campaignId}`);
    return row.id;
  };

  /**
   * Writers of one pack take turns: the next version is the newest plus one, so two writers at the same moment would both claim
   * it. The turn is a lock on the pack's campaign row for one transaction; "no key update" leaves inserts of the campaign's
   * entries and assets (foreign keys) unhindered.
   */
  async function inTurn<T>(pack: string, write: (tx: Query) => Promise<T>): Promise<T> {
    const client = await deps.pool.connect();
    try {
      await client.query("begin");
      await client.query("select 1 from campaign where id = $1 for no key update", [pack]);
      const out = await write(async (sql, params = []) => (await client.query(sql, params)).rows);
      await client.query("commit");
      return out;
    } catch (cause) {
      await client.query("rollback").catch(() => {}); // a rollback that fails means the connection is gone: the first error is the one to report
      throw cause;
    } finally {
      client.release();
    }
  }

  return {
    /** The current version of every file of the pack, by name, and which of the five files it still lacks. */
    async list(campaignId: string): Promise<{ files: DocVersion[]; missing: string[] }> {
      const files = (await q(`select distinct on (name) ${META} from context_doc where campaign_id = $1 order by name, version desc`, [await packOf(campaignId)])).map(versionFrom);
      return { files, missing: missingFiles(files.map((f) => f.name)) };
    },
    /** The current version of a file with its text; null when the pack has no such file. */
    async get(campaignId: string, name: string): Promise<Doc | null> {
      refuse(nameProblem(name));
      const row = (await q(`select ${META}, body from context_doc where campaign_id = $1 and name = $2 order by version desc limit 1`, [await packOf(campaignId), name]))[0];
      return row ? { ...versionFrom(row), body: row.body } : null;
    },
    /**
     * Write a file: the text becomes its next version, by `author`, and is a draft until a person confirms it. Text equal to the
     * current version adds nothing (`added` false), so a confirmed file stays confirmed.
     */
    async set(campaignId: string, name: string, body: string, author: string): Promise<{ doc: DocVersion; added: boolean }> {
      refuse(nameProblem(name) ?? bodyProblem(name, body));
      const pack = await packOf(campaignId), text = stored(body);
      return inTurn(pack, async (tx) => {
        const current = (await tx(`select ${META}, body = $3 as same from context_doc where campaign_id = $1 and name = $2 order by version desc limit 1`, [pack, name, text]))[0];
        if (current?.same) return { doc: versionFrom(current), added: false };
        const row = (await tx(`insert into context_doc (campaign_id, name, version, body, author) values ($1,$2,$3,$4,$5) returning ${META}`, [pack, name, (current?.version ?? 0) + 1, text, author]))[0];
        return { doc: versionFrom(row), added: true };
      });
    },
    /** Every version of a file, oldest first: who wrote it and when, who confirmed it and when. Empty when the pack has no such file. */
    async history(campaignId: string, name: string): Promise<DocVersion[]> {
      refuse(nameProblem(name));
      return (await q(`select ${META} from context_doc where campaign_id = $1 and name = $2 order by version`, [await packOf(campaignId), name])).map(versionFrom);
    },
    /**
     * A person confirms the pack as it is now: the current version of `name`, or of every file, gets who and when. A version
     * confirmed earlier keeps that confirmation; returns the versions this call confirmed. `actor` is a label, as for an approval
     * of a calendar entry, not a verified identity: that agents never confirm is a rule of their skills.
     */
    async confirm(campaignId: string, actor: string, name?: string): Promise<DocVersion[]> {
      if (name !== undefined) refuse(nameProblem(name));
      const pack = await packOf(campaignId);
      const rows = await q(
        `with done as (
           update context_doc d set confirmed_at = now(), confirmed_by = $3
           where d.campaign_id = $1 and ($2::text is null or d.name = $2) and d.confirmed_at is null
             and d.version = (select max(version) from context_doc where campaign_id = d.campaign_id and name = d.name)
           returning ${META})
         select * from done order by name`,
        [pack, name ?? null, actor],
      );
      const exists = async () => (await q("select 1 from context_doc where campaign_id = $1 and name = $2 limit 1", [pack, name])).length > 0;
      if (name !== undefined && rows.length === 0 && !(await exists())) throw new Error(`${name} does not exist yet`);
      return rows.map(versionFrom);
    },
    /**
     * Bring in packs that were kept on disk before the database held them: `<dir>/<campaign id>/` with the pack's files. A file
     * the database has no version of becomes version 1 (a draft, by `author`); a file it has is left as it is, so importing
     * twice adds nothing. The folders are only read. `unknown` are folders that are named after no campaign.
     */
    async importDir(dir: string, author: string): Promise<{ packs: ImportedPack[]; unknown: string[] }> {
      if (!(await stat(dir).then((s) => s.isDirectory(), () => false))) throw new Error(`No folder at ${dir}: give the folder that holds the packs (<campaign id>/*.md)`);
      const campaigns = new Map((await q("select id, name from campaign")).map((r: any) => [r.id as string, r.name as string]));
      const packs: ImportedPack[] = [], unknown: string[] = [];
      for (const folder of (await readdir(dir, { withFileTypes: true })).filter((e) => e.isDirectory()).map((e) => e.name).sort()) {
        const campaignName = campaigns.get(folder);
        if (campaignName === undefined) { unknown.push(folder); continue; }
        const files: { name: string; text: string }[] = [], skipped: ImportedPack["skipped"] = [];
        for (const name of (await readdir(join(dir, folder), { recursive: true })).filter((f) => f.endsWith(".md")).sort()) {
          const notPackFile = nameProblem(name);
          const body = notPackFile === null ? await readFile(join(dir, folder, name), "utf8") : "";
          const reason = notPackFile ?? bodyProblem(name, body);
          if (reason === null) files.push({ name, text: stored(body) });
          else skipped.push({ name, reason });
        }
        // the folder's name is the pack's own id, the one the disk layout was keyed by, so it is not resolved to a base again
        const written = await inTurn(folder, async (tx) => {
          const have = new Set((await tx("select distinct name from context_doc where campaign_id = $1", [folder])).map((r: any) => r.name as string));
          const added: string[] = [], kept: string[] = [];
          for (const f of files) {
            if (have.has(f.name)) { kept.push(f.name); continue; }
            await tx("insert into context_doc (campaign_id, name, version, body, author) values ($1,$2,1,$3,$4)", [folder, f.name, f.text, author]);
            added.push(f.name);
          }
          return { added, kept };
        });
        packs.push({ campaignId: folder, campaignName, ...written, skipped });
      }
      return { packs, unknown };
    },
  };
}
