// Virality by rule (docs/analytics.md). Pure: numbers in, verdicts out; no database, and no model judges anything. An entry is compared
// with its own account: its exposures at an age against the median of the previous entries of the same channel at the same age.
// Absolute numbers are not used: ten thousand views is a hit for a small account and a failure for a large one.
import { rate, type EntryMetrics } from "./domain.ts";

const HOUR = 3_600_000;
/** The ages at which an entry's spread is read, counted from the moment it reached its audience. */
export const AGES = { "1h": HOUR, "24h": 24 * HOUR, "7d": 7 * 24 * HOUR } as const;
export type Age = keyof typeof AGES;
/** The verdict is taken at this age: the earlier one is an early signal, the later one shows where the entry settled. */
export const VERDICT_AGE: Age = "24h";
/** A baseline is the median over at most this many earlier entries. */
const BASELINE_ENTRIES = 20;
/** With fewer earlier entries than this that have the number there is no baseline: three posts do not say what is usual. */
const MIN_BASELINE_ENTRIES = 5;
/** From this ratio an entry spread above what is usual for its account; the viral ratio is the company's setting. */
const ABOVE_RATIO = 1.5;
/** Under this ratio it spread below what is usual. */
const BELOW_RATIO = 0.67;
/** The style of an entry whose creative was not made from a style, or that has no creative. */
export const NO_STYLE = "none";

export const VERDICTS = ["viral", "above", "typical", "below", "unknown"] as const;
export type Verdict = (typeof VERDICTS)[number];
/**
 * What each verdict says, for a person who reads one: the rule as a sentence, with the numbers the rule itself uses. The viral ratio
 * is the company's setting, so it is named, not quoted.
 */
export const VERDICT_MEANING: Record<Verdict, string> = {
  viral: `Seen far more than usual and passed on: ${VERDICT_AGE} after it went out its views were at least the company's viral ratio times the usual, and it was shared at least as often as the account's posts usually are.`,
  above: `Seen more than usual: ${VERDICT_AGE} after it went out its views were at least ${ABOVE_RATIO} times the usual.`,
  typical: `Seen about as much as usual: ${VERDICT_AGE} after it went out its views were between ${BELOW_RATIO} and ${ABOVE_RATIO} times the usual.`,
  below: `Seen less than usual: ${VERDICT_AGE} after it went out its views were under ${BELOW_RATIO} times the usual.`,
  unknown: `Not judged: the post is younger than ${VERDICT_AGE}, its views are not measured, or fewer than ${MIN_BASELINE_ENTRIES} earlier posts on its channel have views to compare with.`,
};
/** What "the usual" in those sentences is. */
export const BASELINE_MEANING = `The usual is the median of the views that the account's ${BASELINE_ENTRIES} posts before it on the same channel had at the same age.`;
type Rates = { share: number | null; save: number | null; engagement: number | null };

/** An entry with its numbers at each age it has reached; an age it has not reached yet is missing, never read early. */
export type AgedEntry = { entryId: string; channel: string; startedAt: string; at: Partial<Record<Age, EntryMetrics>> };

export type Virality = {
  entryId: string;
  channel: string;
  startedAt: string;
  /** Per age: the entry's exposures, the baseline (the median of the earlier entries at that age) and exposures / baseline. */
  ages: Record<Age, { exposures: number | null; baseline: number | null; ratio: number | null }>;
  /** The entry's rates at the verdict age, the age the baseline share rate is taken at. */
  rates: Rates;
  baselineShareRate: number | null;
  verdict: Verdict;
};

export type StyleVirality = { style: string; entries: number; medianRatio: number | null; medianShareRate: number | null; viral: number };

const ENGAGEMENTS = ["reactions", "comments", "shares", "saves"] as const;

/** Rates over exposures. The engagement rate is the sum of its four rates, so one unknown part makes it unknown, never smaller. */
function ratesOf(m: EntryMetrics | undefined): Rates {
  if (!m) return { share: null, save: null, engagement: null };
  const parts = ENGAGEMENTS.map((k) => rate(m, k));
  return { share: rate(m, "shares"), save: rate(m, "saves"), engagement: parts.includes(null) ? null : (parts as number[]).reduce((t, p) => t + p, 0) };
}

const known = (values: (number | null)[]) => values.filter((v): v is number => v !== null);

const median = (values: number[]): number | null => {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b), mid = sorted.length >> 1;
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
};

/** What is usual for the account: the median over the earlier entries that have the number. */
const baseline = (values: (number | null)[]): number | null => (known(values).length < MIN_BASELINE_ENTRIES ? null : median(known(values)));

/**
 * The entries a baseline is taken from: the BASELINE_ENTRIES of the same channel that reached their audience last before this one.
 * `pool` is the company's entries; a channel is never compared with another one.
 */
export const earlierOf = <T extends { channel: string; startedAt: string }>(entry: { channel: string; startedAt: string }, pool: readonly T[]): T[] =>
  pool.filter((x) => x.channel === entry.channel && x.startedAt < entry.startedAt).sort((a, b) => b.startedAt.localeCompare(a.startedAt)).slice(0, BASELINE_ENTRIES);

function verdictOf(ratio: number | null, shareRate: number | null, baselineShareRate: number | null, viralRatio: number): Verdict {
  if (ratio === null) return "unknown";
  // reach that was bought or accidental does not count: an entry nobody shared, or one shared less often than the account's posts
  // usually are, is at most "above" (the first also where the account's posts usually get no shares at all)
  if (ratio >= viralRatio && shareRate !== null && shareRate > 0 && baselineShareRate !== null && shareRate >= baselineShareRate) return "viral";
  if (ratio >= ABOVE_RATIO) return "above";
  return ratio >= BELOW_RATIO ? "typical" : "below";
}

/**
 * Judge one entry against the earlier entries of its channel in `pool`. Every number is taken at the same age on both sides: the entry's
 * exposures 24 hours after its start against the earlier entries' exposures 24 hours after theirs, never against their latest totals.
 * Unknown in, unknown out: no exposures at the verdict age (not measured, or the entry is younger), or too little history, is `unknown`.
 */
export function judge(entry: AgedEntry, pool: readonly AgedEntry[], viralRatio: number): Virality {
  const earlier = earlierOf(entry, pool);
  const exposures = (e: AgedEntry, age: Age) => e.at[age]?.values.exposures ?? null;
  const ages = Object.fromEntries((Object.keys(AGES) as Age[]).map((age) => {
    const own = exposures(entry, age), usual = baseline(earlier.map((e) => exposures(e, age)));
    return [age, { exposures: own, baseline: usual, ratio: own === null || usual === null || usual <= 0 ? null : own / usual }];
  })) as Virality["ages"];
  const rates = ratesOf(entry.at[VERDICT_AGE]);
  const baselineShareRate = baseline(earlier.map((e) => ratesOf(e.at[VERDICT_AGE]).share));
  return { entryId: entry.entryId, channel: entry.channel, startedAt: entry.startedAt, ages, rates, baselineShareRate, verdict: verdictOf(ages[VERDICT_AGE].ratio, rates.share, baselineShareRate, viralRatio) };
}

/**
 * What each style brought: its entries, the median of their ratios and of their share rates at the verdict age, and how many went
 * viral. An entry whose number is unknown counts as an entry but not in the median. Best median ratio first, unknown ones last.
 */
export function byStyle(rows: readonly (Pick<Virality, "ages" | "rates" | "verdict"> & { style: string })[]): StyleVirality[] {
  const styles = [...new Set(rows.map((r) => r.style))];
  return styles.map((style) => {
    const of = rows.filter((r) => r.style === style);
    return {
      style, entries: of.length,
      medianRatio: median(known(of.map((r) => r.ages[VERDICT_AGE].ratio))),
      medianShareRate: median(known(of.map((r) => r.rates.share))),
      viral: of.filter((r) => r.verdict === "viral").length,
    };
  }).sort((a, b) => (b.medianRatio ?? -1) - (a.medianRatio ?? -1) || a.style.localeCompare(b.style));
}
