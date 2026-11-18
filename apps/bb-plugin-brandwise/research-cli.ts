// CLI of research: `bb brandwise research ...`. Reading a company's site (the fence around the requests, what is taken from a
// page, what is kept) lives in packages/core/src/context; this file parses arguments and prints the digest. The onboarding
// wizard (skills/product-onboarding) drafts the product pack from it.
import type { SiteDigest } from "./core/context/index.ts";
import type { Core } from "./core/index.ts";

type Io = { val: (argv: string[], name: string) => string | undefined; positional: (argv: string[]) => string[]; reply: (value: unknown, text: string) => { exitCode: number; stdout: string }; usage: string; actor: (argv: string[]) => string };

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

/** `bb brandwise research site <url> [--pages 12] [--campaign <c>] [--as <label>]` */
export async function researchCli(c: Core, action: string | undefined, args: string[], { val, positional, reply, usage, actor }: Io) {
  const [address] = positional(args.slice(2));
  if (action !== "site" || !address) return { exitCode: 1, stderr: usage };
  const pages = val(args, "--pages");
  const digest = await c.context.researchSite((await c.campaigns.resolve(val(args, "--campaign"))).id, address, { pages: pages === undefined ? undefined : Number(pages), actor: actor(args) });
  return reply(digest, fmt(digest));
}
