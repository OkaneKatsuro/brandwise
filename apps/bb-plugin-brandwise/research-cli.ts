// CLI of research: `bb brandwise research ...`. Reading a company's site, taking its look from a rendered page and reading what
// it already posts (the fence around the requests and around the browser, what is taken, what is kept) live in
// packages/core/src/context; this file parses arguments and prints what was found. The onboarding wizard (skills/product-onboarding) drafts the product pack
// and the look's two files from it.
import type { ListPosts, LookDigest, SiteDigest, SocialDigest } from "./core/context/index.ts";
import type { Render } from "./core/context/research.ts";
import type { Core } from "./core/index.ts";

type Io = {
  val: (argv: string[], name: string) => string | undefined; positional: (argv: string[]) => string[]; reply: (value: unknown, text: string) => { exitCode: number; stdout: string }; usage: string; actor: (argv: string[]) => string;
  /** The browser a look is taken with: the Chrome of the optional engine, as the plugin's settings name it at this moment. */
  render: () => Render;
  /** Lists the posts of a public profile with the tools of this host. */
  listPosts: ListPosts;
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

const number = (n: number | null, what: string) => (n === null ? null : `${n.toLocaleString("en")} ${what}`);
const post = (p: SocialDigest["posts"][number]) => [
  `${p.publishedAt?.slice(0, 10) ?? "undated"}  ${p.format}  ${[number(p.views, "views"), number(p.likes, "likes"), number(p.comments, "comments")].filter(Boolean).join(", ") || "no public counts"}  ${p.url}`,
  ...quoted(p.text === "" ? ["(no text)"] : [`${p.text.replaceAll("\n", " / ")}${p.text.length < p.textLength ? "…" : ""}`]),
];

/** What a profile's posts say together, in numbers counted by code, then the newest posts with the start of their text, quoted. */
const fmtSocial = (d: SocialDigest) => {
  const a = d.audit;
  return [
    d.notice,
    `${d.profile.url}: ${a.posts} ${a.posts === 1 ? "post" : "posts"} read${a.from && a.to ? `, from ${a.from.slice(0, 10)} to ${a.to.slice(0, 10)}` : ""}; all of them, whole, in asset ${d.assetId}`,
    `rhythm: ${a.perWeek === null ? "not known (the posts carry no dates, or too few do)" : `${a.perWeek} posts a week`}`,
    `formats: ${Object.entries(a.formats).map(([format, n]) => `${format} ${n}`).join(", ")}`,
    `usual for a post: ${[number(a.usual.views, "views"), number(a.usual.likes, "likes"), number(a.usual.comments, "comments")].filter(Boolean).join(", ") || "the platform shows no counts"}`,
    ...(a.hashtags.length ? [`hashtags used more than once: ${a.hashtags.map((h) => `${h.tag} (${h.posts})`).join(", ")}`] : []),
    "", "seen most:", ...a.top.flatMap(post),
    "", "how the newest posts open:", ...quoted(a.openings),
    "", "the newest posts:", ...d.posts.flatMap(post),
  ].join("\n");
};

/** `bb brandwise research site <url> [--pages 12] | look <url> | social <profile url> [--last 30]`, each with `[--campaign <c>] [--as <label>]` */
export async function researchCli(c: Core, action: string | undefined, args: string[], { val, positional, reply, usage, actor, render, listPosts }: Io) {
  const [address] = positional(args.slice(2));
  if ((action !== "site" && action !== "look" && action !== "social") || !address) return { exitCode: 1, stderr: usage };
  const campaignId = (await c.campaigns.resolve(val(args, "--campaign"))).id;
  if (action === "social") {
    const last = val(args, "--last");
    const social = await c.context.researchSocial(campaignId, address, { list: listPosts, last: last === undefined ? undefined : Number(last), actor: actor(args) });
    return reply(social, fmtSocial(social));
  }
  if (action === "look") {
    const look = await c.context.researchLook(campaignId, address, { render: render(), actor: actor(args) });
    return reply(look, fmtLook(look));
  }
  const pages = val(args, "--pages");
  const digest = await c.context.researchSite(campaignId, address, { pages: pages === undefined ? undefined : Number(pages), actor: actor(args) });
  return reply(digest, fmt(digest));
}
