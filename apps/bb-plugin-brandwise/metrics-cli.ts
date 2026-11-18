// CLI of the metrics service: `bb brandwise metrics ...`. Read-only except `pull`, which only asks sources for numbers and stores them.
// The service itself lives in packages/core/src/metrics; this file parses arguments and prints.
import type { Core } from "./core/index.ts";
import type { Links } from "./core/links/index.ts";
import { METRIC_NAMES, type EntryMetrics, type EntryVirality, type Metrics, type StyleVirality } from "./core/metrics/index.ts";

type Io = { val: (argv: string[], name: string) => string | undefined; positional: (argv: string[]) => string[]; reply: (value: unknown, text: string) => { exitCode: number; stdout: string }; usage: string };

const pct = (v: number | null) => (v === null ? "n/a" : `${(100 * v).toFixed(2)} %`);
const ratio = (m: EntryMetrics, k: "clicks" | "complaints" | "unsubscribes") => {
  const a = m.values[k], b = m.values.exposures;
  return a === undefined || b === undefined || b <= 0 ? null : a / b;
};
/** One line per entry: the numbers it has; without any, whether a source could measure it at all. */
const fmt = (m: EntryMetrics, measured: boolean, title?: string) => {
  const have = METRIC_NAMES.filter((k) => m.values[k] !== undefined).map((k) => `${k} ${m.values[k]}`);
  const none = measured ? "no numbers yet (a pull source reports after its next pull, or its token is not set)" : "no numbers: no source measures this channel";
  return `${m.entryId}  ${m.channel.padEnd(9)} started ${m.startedAt?.slice(0, 16) ?? "not yet"}  ${have.length ? have.join(", ") : none}` +
    `${m.values.exposures !== undefined ? `  (click rate ${pct(ratio(m, "clicks"))})` : ""}${title ? `  "${title}"` : ""}`;
};
/** How many times the account's usual number: "x4.00". */
const times = (v: number | null) => (v === null ? "n/a" : `x${v.toFixed(2)}`);
/** How long ago the entry reached its audience: "40m", "5h", "3d". */
const ageOf = (startedAt: string, asOf: Date) => {
  const minutes = Math.floor((asOf.getTime() - Date.parse(startedAt)) / 60_000);
  return minutes < 60 ? `${minutes}m` : minutes < 1440 ? `${Math.floor(minutes / 60)}h` : `${Math.floor(minutes / 1440)}d`;
};
const fmtVirality = (v: EntryVirality, asOf: Date) =>
  `${v.entryId}  ${v.channel.padEnd(9)} age ${ageOf(v.startedAt, asOf).padEnd(4)} exposures ${String(v.exposures ?? "n/a").padStart(7)}  1h ${times(v.ages["1h"].ratio).padEnd(7)} 24h ${times(v.ages["24h"].ratio).padEnd(7)} ` +
  `share rate ${pct(v.rates.share).padEnd(8)} ${v.verdict.padEnd(7)}  style ${v.style}  "${v.title}"`;
const fmtStyle = (s: StyleVirality) =>
  `${s.style.padEnd(24)} ${String(s.entries).padStart(4)} entries  median ratio ${times(s.medianRatio).padEnd(7)} median share rate ${pct(s.medianShareRate).padEnd(8)} ${s.viral} viral`;

export function createMetricsCli(deps: { core: () => Core; metrics: () => Metrics | null; links: () => Links | null; now: () => Promise<Date> }) {
  return async function metricsCli(action: string | undefined, args: string[], io: Io) {
    const { val, positional, reply, usage } = io;
    const m = deps.metrics();
    if (!m) return { exitCode: 1, stderr: "Metrics need the database: run infra/bb-instance/provision.sh apply" };
    const asOfArg = val(args, "--as-of");
    const asOf = asOfArg ? new Date(asOfArg) : await deps.now();
    if (Number.isNaN(asOf.getTime())) return { exitCode: 1, stderr: `Invalid --as-of: ${asOfArg}` };
    if (action === "sources") {
      const s = m.sources();
      return reply(s, s.map((x) => `${x.id.padEnd(10)} ${x.mode.padEnd(5)} channels ${x.channels.join(", ")}; measures ${x.measures.join(", ")}`).join("\n") || "No metrics sources.");
    }
    if (action === "entry") {
      const id = positional(args.slice(2))[0];
      if (!id) return { exitCode: 1, stderr: usage };
      const e = await m.entry(id, asOf);
      return reply(e, fmt(e, m.sourcesFor(e.channel).length > 0));
    }
    if (action === "campaign") {
      const c = await deps.core().campaigns.resolve(val(args, "--campaign"));
      const entries = await m.published(c.id);
      const numbers = await m.forEntries(entries, asOf);
      if (numbers.length === 0) return reply(numbers, `Nothing published in ${c.name} yet.`);
      // the funnel of the campaign: only metrics some source reported, summed over the entries that have them
      const total = (k: (typeof METRIC_NAMES)[number]) => { const have = numbers.filter((x) => x.values[k] !== undefined); return have.length ? `${k} ${have.reduce((t, x) => t + x.values[k]!, 0)} (${have.length} entries)` : null; };
      const funnel = (["exposures", "reach", "clicks", "visits", "leads", "orders", "revenue", "spend"] as const).map(total).filter(Boolean).join(", ");
      return reply(numbers, `${numbers.map((x, i) => fmt(x, m.sourcesFor(x.channel).length > 0, entries[i].title)).join("\n")}\nTotal: ${funnel || "no numbers yet"}`);
    }
    if (action === "virality") {
      const c = await deps.core().campaigns.resolve(val(args, "--campaign"));
      const channel = val(args, "--channel"), last = val(args, "--last");
      if (last !== undefined && !(Number.isInteger(Number(last)) && Number(last) > 0)) return { exitCode: 1, stderr: "--last is a positive whole number" };
      const rows = await m.virality(c, asOf, { channel, last: Number(last ?? 20) });
      return reply(rows, rows.map((r) => fmtVirality(r, asOf)).join("\n") || `Nothing published in ${c.name}${channel ? ` on ${channel}` : ""} yet.`);
    }
    if (action === "styles") {
      const c = await deps.core().campaigns.resolve(val(args, "--campaign"));
      const rows = await m.styles(c, asOf);
      return reply(rows, rows.map(fmtStyle).join("\n") || `Nothing published in ${c.name} yet.`);
    }
    if (action === "links") {
      const id = positional(args.slice(2))[0];
      if (!id) return { exitCode: 1, stderr: usage };
      const l = deps.links();
      if (!l) return { exitCode: 1, stderr: "Short links need the database" };
      const rows = await l.stats(id);
      const off = l.enabled() ? "" : "\nShort links are off: set the public address under Settings > Short links.";
      return reply(rows, (rows.map((r) => `${String(r.visitors).padStart(5)} visitors  ${String(r.clicks).padStart(5)} clicks  ${String(r.bots).padStart(4)} bots  ${r.short ?? "(not shortened)"}  ->  ${r.url}`).join("\n") || "No short links for this entry.") + off);
    }
    if (action === "pull") {
      const days = val(args, "--days");
      if (days !== undefined && !(Number(days) > 0)) return { exitCode: 1, stderr: "--days is a positive number" };
      const r = await m.pull(asOf, { source: val(args, "--source"), days: days === undefined ? undefined : Number(days) });
      const text = r.map((x) => `${x.source}: ${x.entries} entries asked, ${x.stored} numbers stored${x.error ? `, ${x.partial ? "FAILED for some" : "FAILED"}: ${x.error}` : ""}`).join("\n") || "No pull sources: e-mail is read live and needs no pull.";
      // The hourly automation runs this. bb pauses an automation after three failing runs, which would stop every source; so one broken
      // source (an expired token, one client's lost access) is reported in the output and does not fail the run. Only a run in which
      // no source that had entries to ask got anything through fails.
      const asked = r.filter((x) => x.entries > 0);
      const nothingWorked = asked.length > 0 && asked.every((x) => x.error && !x.partial);
      return nothingWorked ? { exitCode: 1, stderr: text } : reply(r, text);
    }
    return { exitCode: 1, stderr: usage };
  };
}
