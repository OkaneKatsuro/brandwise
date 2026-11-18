// CLI of research: `bb brandwise research ...`. Reading a company's site and taking its look from a rendered page (the fence
// around the requests and around the browser, what is taken from a page, what is kept) live in packages/core/src/context; this
// file parses arguments and prints what was found. The onboarding wizard (skills/product-onboarding) drafts the product pack
// and the look's two files from it.
import type { LookDigest, SiteDigest } from "./core/context/index.ts";
import type { Render } from "./core/context/research.ts";
import type { Core } from "./core/index.ts";

type Io = {
  val: (argv: string[], name: string) => string | undefined; positional: (argv: string[]) => string[]; reply: (value: unknown, text: string) => { exitCode: number; stdout: string }; usage: string; actor: (argv: string[]) => string;
  /** The browser a look is taken with: the Chrome of the optional engine, as the plugin's settings name it at this moment. */
  render: () => Render;
};

/** What the site wrote, as quoted lines: no line of it can pass for one of ours. */
const quoted = (lines: string[]) => lines.map((line) => `> ${line}`);

/** One page: its address and asset, then what it says about itself and the start of its text, quoted. */
const fmtPage = (p: SiteDigest["pages"][number]) => [
  `page ${p.url}  (asset ${p.assetId})`,
  ...quoted([
    ...(p.title === null ? [] : [`title: ${p.title}`]),
    ...(p.description === null ? [] : [`description: ${p.description}`]),
    ...Object.entries(p.og).map(([name, value]) => `og:${name}: ${value}`),
    ...p.jsonLd.map((entity) => `json-ld: ${JSON.stringify(entity)}`),
  ]),
  ...(p.jsonLdOmitted > 0 ? [`json-ld: ${p.jsonLdOmitted} more did not fit`] : []),
  p.textLength === 0 ? "text: none"
    : p.text === "" ? `text: not shown, the digest is full (${p.textLength} characters)`
    : p.text.length < p.textLength ? `text, the first ${p.text.length} of ${p.textLength} characters:` : "text:",
  ...(p.text === "" ? [] : quoted(p.text.split("\n"))),
  ...(p.note === null ? [] : [`note: ${p.note}`]),
].join("\n");

const fmt = (d: SiteDigest) => [
  `${d.notice}\n${d.site}: ${d.pages.length} ${d.pages.length === 1 ? "page" : "pages"} read, ${d.skipped.length} skipped`,
  ...d.pages.map(fmtPage),
  ...(d.skipped.length ? [d.skipped.map((s) => `skipped ${s.url}: ${s.reason}`).join("\n")] : []),
].join("\n\n");

/**
 * The candidates of a look: the picture's asset, then each colour and font with how it was found, the logo addresses and what
 * was refused. A colour is a hex value code made. A font name and an address are the page's own words, the address the browser
 * ended on among them, since the page may send it anywhere: each stands in quotes, as JSON writes them, so nothing in it can
 * pass for a word of ours; a refused host is on a quoted line, like the text of a site.
 */
const fmtLook = (d: LookDigest) => {
  const rows = (found: Record<string, { value: string; from: string } | null>, show: (value: string) => string) =>
    Object.entries(found).map(([name, f]) => `  ${name.padEnd(11)} ${f === null ? "not found" : `${show(f.value)}  (${f.from})`}`);
  return [
    d.notice,
    `page ${JSON.stringify(d.page)}: its picture is asset ${d.assetId}. Show it with ::creative{ids="${d.assetId}"}`,
    ...(d.note === null ? [] : [`note: ${d.note}`]),
    "colours:", ...rows(d.colors, (hex) => hex),
    "fonts:", ...rows(d.fonts, (family) => JSON.stringify(family)),
    "logo candidates:", ...(d.logos.length ? d.logos.map((l) => `  ${l.url === null ? "" : `${JSON.stringify(l.url)}  `}(${l.from})`) : ["  none found"]),
    ...(d.refused.count === 0 ? [] : [
      `refused: ${d.refused.count} ${d.refused.count === 1 ? "connection" : "connections"} the page asked for; it was rendered without them`,
      ...quoted(d.refused.targets.map((r) => `${r.to}: ${r.reason}`)),
    ]),
  ].join("\n");
};

/** `bb brandwise research site <url> [--pages 12] | look <url>`, each with `[--campaign <c>] [--as <label>]` */
export async function researchCli(c: Core, action: string | undefined, args: string[], { val, positional, reply, usage, actor, render }: Io) {
  const [address] = positional(args.slice(2));
  if ((action !== "site" && action !== "look") || !address) return { exitCode: 1, stderr: usage };
  const campaignId = (await c.campaigns.resolve(val(args, "--campaign"))).id;
  if (action === "look") {
    const look = await c.context.researchLook(campaignId, address, { render: render(), actor: actor(args) });
    return reply(look, fmtLook(look));
  }
  const pages = val(args, "--pages");
  const digest = await c.context.researchSite(campaignId, address, { pages: pages === undefined ? undefined : Number(pages), actor: actor(args) });
  return reply(digest, fmt(digest));
}
