// The company's look as its page shows it, the pure part (docs/context-styles-map.md, step 3). A browser renders the page and
// computes values for its elements (packages/email-engine/look.mjs reads them and decides nothing); here they become candidates:
// the colours of the page by where they are used, the font families of headings and text, and where a logo may be. Code takes
// them, never a model; each says how it was found, and what is not found is absent, never guessed. What a candidate means (which
// colour is the brand's) is proposed by an agent and confirmed by a person, in the pack's design.json (design.ts).
import { MAX_FONT } from "./design.ts";
import { addressProblem, line } from "./site.ts";

/** A colour as the browser paints it: red, green, blue and alpha, each from 0 to 255. */
type Rgba = readonly [red: number, green: number, blue: number, alpha: number];

/** What the browser computed for one element. */
export type Sample = {
  /** The colour of its text. */
  color: Rgba | null;
  /** Its own background colour; fully transparent when it sets none. */
  background: Rgba | null;
  /** What it stands on: the nearest opaque background colour among the elements it is in; null when none of them sets one. */
  backdrop: Rgba | null;
  /** Its font stack, as CSS writes it. */
  fontFamily: string;
  /** How far down the page it starts, in pixels. */
  top: number;
  /** Whether it takes up room on the page and is not hidden. */
  shown: boolean;
};

/** What the browser computed for the elements a look is taken from; every list in the order of the page, and bounded. */
export type RenderedPage = {
  /** Where the browser ended, after the page's redirects. */
  url: string;
  /** The height of one screen, in pixels. */
  screenHeight: number;
  html: Sample;
  /** Null for a page without a body. */
  body: Sample | null;
  paragraphs: Sample[];
  /** `h1` to `h3`, with their level. */
  headings: (Sample & { level: number })[];
  /** Buttons and links: whether it is a link, and whether it stands in the page's header or inside a paragraph. */
  actions: (Sample & { link: boolean; inHeader: boolean; inParagraph: boolean })[];
  /** The addresses of the page's icon links. */
  icons: string[];
  /** The first image or inline SVG in the header: an image by its address, an SVG only as being there. */
  headerImage: { src: string } | { svg: true } | null;
  /** What the page names as its OpenGraph image. */
  ogImage: string | null;
};

/** A value taken from the page, and how it was found. */
type Found = { value: string; from: string };

/** The candidates of a page. A value that was not found is null. */
export type LookCandidates = {
  /** Colours as hex, by where the page uses them: its background, its text, its headings, its links, and its main button with the text on it. */
  colors: Record<"background" | "text" | "heading" | "link" | "button" | "buttonText", Found | null>;
  /** The first family of the font stack of headings and of text. They are the page's own words. */
  fonts: Record<"heading" | "body", Found | null>;
  /** Where a logo may be, by address; `url` is null for an inline SVG, which has none. The addresses are the page's own words. */
  logos: { from: string; url: string | null }[];
  /** What is to be said about the page as a whole; null when nothing. */
  note: string | null;
};

const NO_TEXT_NOTE = "no heading and no paragraph is shown with the page's scripts off: the page is probably rendered in the browser";

const hex = (c: Rgba): string => `#${[c[0], c[1], c[2]].map((part) => part.toString(16).padStart(2, "0")).join("")}`;
const blend = (top: number, under: number, alpha: number) => Math.round((top * alpha + under * (255 - alpha)) / 255);
/** A translucent colour over an opaque one: what is seen. */
const over = (top: Rgba, under: Rgba): Rgba => [blend(top[0], under[0], top[3]), blend(top[1], under[1], top[3]), blend(top[2], under[2], top[3]), 255];

/**
 * A colour as it is seen: an opaque one as it is, a translucent one over what lies under it. Null when it paints nothing, or
 * when it lets through something that is not known.
 */
function seen(color: Rgba | null, under: Rgba | null): Rgba | null {
  if (color === null || color[3] === 0) return null;
  return color[3] === 255 ? color : under === null ? null : over(color, under);
}
/** What the text of an element is read against: its own background where it has one, else what it stands on. */
const ground = (s: Sample): Rgba | null => (s.background === null || s.background[3] === 0 ? s.backdrop : seen(s.background, s.backdrop));

const found = (color: Rgba | null, from: string): Found | null => (color === null ? null : { value: hex(color), from });
const textOf = (s: Sample | undefined, from: string): Found | null => (s === undefined ? null : found(seen(s.color, ground(s)), from));

/** The first family of a font stack, without its quotes; null when the stack names none. */
function firstFamily(stack: string): string | null {
  const first = /^\s*(?:"([^"]*)"|'([^']*)'|([^,]*))/.exec(stack);
  return line(first?.[1] ?? first?.[2] ?? first?.[3], MAX_FONT);
}
const fontOf = (s: Sample | undefined, from: string): Found | null => {
  const family = s === undefined ? null : firstFamily(s.fontFamily);
  return family === null ? null : { value: family, from };
};

/** What a page names as an image, as an address that may be read; null when it is none (a data: address, one of this machine). */
function imageAddress(named: string | null, page: string): string | null {
  const url = named === null || named.trim() === "" ? null : URL.parse(named.trim(), page);
  return url !== null && addressProblem(url) === null ? url.href : null;
}

/**
 * The candidates of a rendered page.
 * - Background: the body's own, else the one of `html`. A page that sets neither has none: what the browser paints then is not the page's.
 * - Text: the first paragraph that is shown; a page without one has the text of its body.
 * - Headings: the first `h1` that is shown, without one the first `h2`, then `h3`.
 * - Links: the first link inside a paragraph. Links of a menu are styled as the menu, not as links.
 * - Main button: the first button or link, in the header or on the first screen, that is painted as a filled box: its own
 *   background is opaque and is not the colour it stands on.
 * - Fonts: the first family of the stack of that heading and of that text.
 * - Logo: the icon link, the first image or inline SVG in the header, the OpenGraph image.
 */
export function lookCandidates(page: RenderedPage): LookCandidates {
  const paragraph = page.paragraphs.find((p) => p.shown);
  const heading = [1, 2, 3].flatMap((level) => page.headings.filter((h) => h.shown && h.level === level))[0];
  const text = paragraph ?? page.body ?? undefined, textFrom = paragraph ? "the first paragraph" : "body";
  const headingFrom = heading ? `the first h${heading.level}` : "";
  const button = page.actions.find((a) => a.shown && (a.inHeader || a.top < page.screenHeight)
    && a.background !== null && a.background[3] === 255 && (a.backdrop === null || hex(a.background) !== hex(a.backdrop)));
  const icon = page.icons.map((href) => imageAddress(href, page.url)).find((url) => url !== null);
  const inHeader = page.headerImage === null ? null : "svg" in page.headerImage ? null : imageAddress(page.headerImage.src, page.url);
  const og = imageAddress(page.ogImage, page.url);
  return {
    colors: {
      background: (page.body === null ? null : found(seen(page.body.background, page.body.backdrop), "body")) ?? found(seen(page.html.background, null), "html"),
      text: textOf(text, textFrom),
      heading: textOf(heading, headingFrom),
      link: textOf(page.actions.find((a) => a.shown && a.link && a.inParagraph), "the first link in a paragraph"),
      button: button ? found(button.background, `the first filled ${button.link ? "link" : "button"} ${button.inHeader ? "in the header" : "on the first screen"}`) : null,
      buttonText: button ? found(seen(button.color, button.background), "the text on that button") : null,
    },
    fonts: { heading: fontOf(heading, headingFrom), body: fontOf(text, textFrom) },
    logos: [
      ...(icon ? [{ from: "the page's icon", url: icon }] : []),
      ...(inHeader ? [{ from: "the first image in the header", url: inHeader }] : []),
      ...(page.headerImage !== null && "svg" in page.headerImage ? [{ from: "an inline SVG in the header: it has no address, the picture of the page shows it", url: null }] : []),
      ...(og ? [{ from: "the OpenGraph image", url: og }] : []),
    ],
    note: paragraph === undefined && heading === undefined ? NO_TEXT_NOTE : null,
  };
}
