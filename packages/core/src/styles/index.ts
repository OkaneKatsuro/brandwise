// The style library: the styles a creative can be generated in, and the generation that names one. A style is never copied per
// company; the caller picks one, fills its slots and code writes the prompt. Beside the built-in styles there are the styles of
// packs (docs/context-styles-map.md, step 6), kept in Postgres, the same on every machine. A pack's text becomes prompts, so its
// styles count only while the pack is switched on, which a person does after reading them.
import type pg from "pg";
import { BUILTIN_STYLES } from "./builtin/index.ts";
import { selectStyles, styledSpec, type Style, type StyleRef, type StyleRequest } from "./domain.ts";
import { checkPack, packSource } from "./pack.ts";
import { readFolder, type Fetch } from "./source.ts";

export type { Style, StyleRef } from "./domain.ts";

/** A pack as it is stored: where it came from, who added it, the addresses of its styles, and who switched it on (null: it is off). */
export type InstalledPack = {
  name: string; source: string; revision: string | null; author: string; licence: string; styles: string[];
  installedAt: string; installedBy: string; enabledAt: string | null; enabledBy: string | null;
};

type Query = (sql: string, params?: unknown[]) => Promise<any[]>;

const PACK = `p.name, p.source, p.revision, p.author, p.licence, p.installed_at, p.installed_by, p.enabled_at, p.enabled_by,
  array(select s.pack || '/' || s.id from style_pack_style s where s.pack = p.name order by s.id) as styles`;
const packFrom = (r: any): InstalledPack => ({
  name: r.name, source: r.source, revision: r.revision, author: r.author, licence: r.licence, styles: r.styles,
  installedAt: new Date(r.installed_at).toISOString(), installedBy: r.installed_by,
  enabledAt: r.enabled_at ? new Date(r.enabled_at).toISOString() : null, enabledBy: r.enabled_by,
});
/** A pack's style as the library hands it out: under its address, so that it can never stand in for a built-in style or another pack's. */
const addressed = (pack: string, body: Style): Style => ({ ...body, id: `${pack}/${body.id}` });

export function createStyles(deps: { pool: pg.Pool; fetch: Fetch }) {
  const q: Query = async (sql, params = []) => (await deps.pool.query(sql, params)).rows;

  /** One transaction: what `write` does is stored together or not at all. */
  async function inTransaction<T>(write: (tx: Query) => Promise<T>): Promise<T> {
    const client = await deps.pool.connect();
    try {
      await client.query("begin");
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

  const noPack = (name: string) => new Error(`No style pack "${name}". bb brandwise style packs lists the packs there are.`);
  const packNamed = async (name: string): Promise<InstalledPack> => {
    const row = (await q(`select ${PACK} from style_pack p where p.name = $1`, [name]))[0];
    if (!row) throw noPack(name);
    return packFrom(row);
  };

  /** The style at an address and where it comes from: a bare id is a built-in style, `<pack>/<id>` a style of a pack that is on. */
  async function find(address: string): Promise<{ style: Style; origin: StyleRef["origin"] }> {
    const slash = address.indexOf("/");
    if (slash < 0) {
      const style = BUILTIN_STYLES.find((s) => s.id === address);
      if (!style) throw new Error(`Unknown style "${address}". The built-in styles are ${BUILTIN_STYLES.map((s) => s.id).join(", ")}; a style of a pack is named <pack>/<id>. bb brandwise style list says what each is for.`);
      return { style, origin: "built-in" };
    }
    const pack = address.slice(0, slash);
    const row = (await q(
      `select p.enabled_at, array(select id from style_pack_style where pack = p.name order by id) as ids,
              (select body from style_pack_style where pack = p.name and id = $2) as body
       from style_pack p where p.name = $1`,
      [pack, address.slice(slash + 1)],
    ))[0];
    if (!row) throw new Error(`Unknown style "${address}": there is no style pack "${pack}". bb brandwise style packs lists the packs there are.`);
    if (row.enabled_at === null) throw new Error(`Style pack "${pack}" is switched off, so "${address}" cannot be shown or used. A pack's text becomes prompts: a person reads its styles first and then switches it on with bb brandwise style enable ${pack}.`);
    if (row.body === null) throw new Error(`Unknown style "${address}". Pack "${pack}" has ${row.ids.map((id: string) => `${pack}/${id}`).join(", ")}; bb brandwise style list says what each is for.`);
    return { style: addressed(pack, row.body), origin: `pack:${pack}` };
  }

  return {
    /** The styles of a kind and for a channel; without a filter, all of them. Built-in styles first, then those of the packs that are on. */
    async list(filter: { kind?: string; channel?: string }): Promise<Style[]> {
      const rows = await q("select s.pack, s.body from style_pack_style s join style_pack p on p.name = s.pack where p.enabled_at is not null order by s.pack, s.id");
      return selectStyles([...BUILTIN_STYLES, ...rows.map((r) => addressed(r.pack, r.body))], filter);
    },
    /** The style at this address, or an error that says what there is; for a pack that is off, that it is off and who switches it on. */
    async byId(address: string): Promise<Style> {
      return (await find(address)).style;
    },
    /** A generation that names a style by its address (styledSpec): the asset records the address, the version and the origin. */
    async spec(request: StyleRequest & { style: string }) {
      const { style, origin } = await find(request.style);
      return styledSpec(style, origin, request);
    },
    /** Every pack, by name, switched on or not. */
    async packs(): Promise<InstalledPack[]> {
      return (await q(`select ${PACK} from style_pack p order by p.name`)).map(packFrom);
    },
    /**
     * Add a pack from a folder or from the https address of a git repository. It is read and checked whole before anything is
     * stored, and it is stored switched off. A pack of that name that is already there is replaced, styles and all, and is off
     * again: its text changed and no person has read the new one. `replaced` says that one was there.
     */
    async addPack(given: string, actor: string): Promise<InstalledPack & { replaced: boolean }> {
      const source = packSource(given);
      const { entries, revision } = source.kind === "folder" ? { entries: await readFolder(source.location), revision: null } : await deps.fetch(source.location);
      const pack = checkPack(entries);
      return inTransaction(async (tx) => {
        const replaced = (await tx("select 1 from style_pack where name = $1", [pack.name])).length > 0;
        // the update of an existing row waits for whoever else is adding this pack, so two of them take turns
        await tx(
          `insert into style_pack (name, source, revision, author, licence, installed_by) values ($1,$2,$3,$4,$5,$6)
           on conflict (name) do update set source = excluded.source, revision = excluded.revision, author = excluded.author, licence = excluded.licence,
             installed_at = now(), installed_by = excluded.installed_by, enabled_at = null, enabled_by = null`,
          [pack.name, source.location, revision, pack.author, pack.licence, actor],
        );
        await tx("delete from style_pack_style where pack = $1", [pack.name]);
        await tx("insert into style_pack_style (pack, id, body) select $1, s ->> 'id', s from json_array_elements($2::json) s", [pack.name, JSON.stringify(pack.styles)]);
        return { ...packFrom((await tx(`select ${PACK} from style_pack p where p.name = $1`, [pack.name]))[0]), replaced };
      });
    },
    /**
     * A person switches a pack on after reading its styles: from then on they are listed and can be used. A pack that is on
     * keeps who switched it on and when. `actor` is a label, as for the confirmation of the product pack, not a verified
     * identity: that agents never switch a pack on is a rule of their skills.
     */
    async enablePack(name: string, actor: string): Promise<InstalledPack> {
      await q("update style_pack set enabled_at = now(), enabled_by = $2 where name = $1 and enabled_at is null", [name, actor]);
      return packNamed(name);
    },
    /** Switch a pack off: its styles are no longer listed and cannot be used; assets made in them keep their record. */
    async disablePack(name: string): Promise<InstalledPack> {
      await q("update style_pack set enabled_at = null, enabled_by = null where name = $1", [name]);
      return packNamed(name);
    },
    /** Delete a pack and its styles. */
    async removePack(name: string): Promise<void> {
      if ((await q("delete from style_pack where name = $1 returning name", [name])).length === 0) throw noPack(name);
    },
  };
}
