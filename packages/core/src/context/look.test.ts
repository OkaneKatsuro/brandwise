// The candidates of a rendered page: what a browser computed for its elements becomes colours by where they are used, font
// families and logo addresses. No browser here: the pages are made up (testing.ts); a real one is in chrome-render.test.ts.
import assert from "node:assert/strict";
import { test } from "node:test";
import { lookCandidates } from "./look.ts";
import { element, renderedPage } from "./testing.ts";

const CLEAR = [0, 0, 0, 0] as const, WHITE = [255, 255, 255, 255] as const, BLUE = [31, 111, 235, 255] as const, NIGHT = [11, 16, 32, 255] as const;
const action = (over: Parameters<typeof element>[0] = {}, where: { link?: boolean; inHeader?: boolean; inParagraph?: boolean } = {}) =>
  ({ ...element(over), link: true, inHeader: false, inParagraph: false, ...where });
const colors = (over: Parameters<typeof renderedPage>[0]) => lookCandidates(renderedPage(over)).colors;

test("the colours of a page are taken by where they are used, as hex, each with how it was found; fonts are the first family of the stack; logos are addresses", () => {
  assert.deepEqual(lookCandidates(renderedPage()), {
    colors: {
      background: { value: "#ffffff", from: "body" },
      text: { value: "#14161a", from: "the first paragraph" },
      heading: { value: "#0b1f44", from: "the first h1" },
      link: { value: "#1f6feb", from: "the first link in a paragraph" },
      button: { value: "#1f6feb", from: "the first filled link in the header" },
      buttonText: { value: "#ffffff", from: "the text on that button" },
    },
    fonts: { heading: { value: "Georgia", from: "the first h1" }, body: { value: "Acme Sans", from: "the first paragraph" } },
    logos: [
      { from: "the page's icon", url: "https://acme.example/favicon.svg" },
      { from: "the first image in the header", url: "https://acme.example/logo.png" },
      { from: "the OpenGraph image", url: "https://acme.example/og.png" },
    ],
    note: null,
  });
});

test("a value that is not on the page is null, never a default: a page of nothing has no candidates, and says that it shows no text", () => {
  const bare = lookCandidates(renderedPage({ html: element({ backdrop: null }), body: element({ color: null, backdrop: null, fontFamily: "" }), paragraphs: [], headings: [], actions: [], icons: [], headerImage: null, ogImage: null }));
  assert.deepEqual(bare.colors, { background: null, text: null, heading: null, link: null, button: null, buttonText: null });
  assert.deepEqual([bare.fonts, bare.logos], [{ heading: null, body: null }, []]);
  assert.match(bare.note ?? "", /no heading and no paragraph is shown with the page's scripts off: the page is probably rendered in the browser/);
  assert.deepEqual(lookCandidates(renderedPage({ body: null, paragraphs: [] })).colors.text, null, "a page without a body");
});

test("the background is the body's own, else the one of html; a page that sets neither has none", () => {
  assert.deepEqual(colors({ body: element({ background: NIGHT, backdrop: null }) }).background, { value: "#0b1020", from: "body" });
  assert.deepEqual(colors({ html: element({ background: NIGHT, backdrop: null }), body: element({ backdrop: NIGHT }) }).background, { value: "#0b1020", from: "html" });
  assert.equal(colors({ html: element({ backdrop: null }), body: element({ backdrop: null }) }).background, null, "what the browser paints then is not the page's");
  assert.deepEqual(colors({ body: null, html: element({ background: NIGHT, backdrop: null }) }).background, { value: "#0b1020", from: "html" }, "a page without a body still has its html");
});

test("text is the first paragraph that is shown; a page without one has the text of its body", () => {
  const grey = element({ color: [90, 96, 110, 255], fontFamily: "Inter, sans-serif" });
  const page = { body: element({ background: WHITE, backdrop: null, color: [1, 2, 3, 255], fontFamily: "Arial" }) };
  const hidden = lookCandidates(renderedPage({ ...page, paragraphs: [element({ shown: false, color: BLUE }), grey, element()] }));
  assert.deepEqual([hidden.colors.text, hidden.fonts.body], [{ value: "#5a606e", from: "the first paragraph" }, { value: "Inter", from: "the first paragraph" }], "a paragraph that is not shown is passed over");
  const none = lookCandidates(renderedPage({ ...page, paragraphs: [element({ shown: false })] }));
  assert.deepEqual([none.colors.text, none.fonts.body], [{ value: "#010203", from: "body" }, { value: "Arial", from: "body" }]);
  assert.equal(none.note, null, "a heading alone is text enough");
});

test("headings are the first h1 that is shown, without one the first h2, then the first h3", () => {
  const h = (level: number, red: number, shown = true) => ({ ...element({ color: [red, 0, 0, 255], fontFamily: `H${level}, serif`, shown }), level });
  const of = (headings: ReturnType<typeof h>[]) => { const look = lookCandidates(renderedPage({ headings })); return [look.colors.heading, look.fonts.heading]; };
  assert.deepEqual(of([h(2, 2), h(3, 3), h(1, 1), h(1, 9)]), [{ value: "#010000", from: "the first h1" }, { value: "H1", from: "the first h1" }], "by level, not by place on the page");
  assert.deepEqual(of([h(3, 3), h(1, 1, false), h(2, 2)]), [{ value: "#020000", from: "the first h2" }, { value: "H2", from: "the first h2" }], "an h1 that is not shown does not count");
  assert.deepEqual(of([h(3, 3)]), [{ value: "#030000", from: "the first h3" }, { value: "H3", from: "the first h3" }]);
  assert.deepEqual(of([]), [null, null]);
});

test("links are the first link inside a paragraph, never a link of the menu or a button", () => {
  const menu = action({ color: [9, 9, 9, 255] }, { inHeader: true }), inText = action({ color: BLUE }, { inParagraph: true });
  assert.deepEqual(colors({ actions: [menu, action({ color: [7, 7, 7, 255] }, { link: false, inParagraph: true }), inText] }).link, { value: "#1f6feb", from: "the first link in a paragraph" });
  assert.equal(colors({ actions: [menu, action({ color: BLUE, shown: false }, { inParagraph: true })] }).link, null, "a page whose text has no link has no link colour");
});

test("the main button is the first button or link, in the header or on the first screen, that is painted as a filled box", () => {
  const filled = { color: WHITE, background: BLUE };
  const menu = action({ top: 20 }, { inHeader: true });
  const main = (actions: ReturnType<typeof action>[]) => { const c = colors({ actions }); return [c.button, c.buttonText]; };
  assert.deepEqual(main([menu, action({ ...filled, top: 500 }, { link: false }), action({ color: WHITE, background: NIGHT, top: 600 })]),
    [{ value: "#1f6feb", from: "the first filled button on the first screen" }, { value: "#ffffff", from: "the text on that button" }], "a button, and the first of two");
  assert.deepEqual(main([action({ ...filled, top: 4000 }, { inHeader: true })])[0], { value: "#1f6feb", from: "the first filled link in the header" }, "the header counts wherever it is");
  assert.deepEqual(main([menu, action({ ...filled, top: 900 }), action({ ...filled, shown: false })]), [null, null], "below the first screen, or not shown, is not the main button");
  assert.deepEqual(main([action({ background: CLEAR }), action({ background: [31, 111, 235, 128] }), action({ background: WHITE, backdrop: WHITE })]), [null, null],
    "a link without a background, with one that lets the page through, or of the colour it stands on is not a filled box");
  assert.deepEqual(main([action({ color: [255, 255, 255, 128], background: BLUE })])[1], { value: "#8fb7f5", from: "the text on that button" }, "its text is seen against the button");
});

test("a colour that lets through what is under it is reported as it is seen there, and is absent when that is not known", () => {
  const faint = [0, 0, 0, 153] as const; // black at 60%
  assert.deepEqual(colors({ paragraphs: [element({ color: faint, backdrop: WHITE })] }).text, { value: "#666666", from: "the first paragraph" }, "over white");
  assert.deepEqual(colors({ paragraphs: [element({ color: [255, 255, 255, 153], backdrop: NIGHT })] }).text, { value: "#9d9fa6", from: "the first paragraph" }, "over what the paragraph stands on");
  assert.deepEqual(colors({ paragraphs: [element({ color: faint, background: BLUE, backdrop: WHITE })] }).text, { value: "#0c2c5e", from: "the first paragraph" }, "over the paragraph's own background");
  assert.equal(colors({ paragraphs: [element({ color: faint, backdrop: null })] }).text, null, "nothing around the paragraph sets a background");
  assert.equal(colors({ paragraphs: [element({ color: CLEAR })] }).text, null, "text that is not painted has no colour");
  assert.deepEqual(colors({ body: element({ background: [0, 0, 0, 128], backdrop: WHITE }) }).background, { value: "#7f7f7f", from: "body" }, "a body that lets html through");
});

test("a font is the first family of the stack: without its quotes, on one line, cut at 80 characters, and none when the stack names none", () => {
  const body = (fontFamily: string) => lookCandidates(renderedPage({ paragraphs: [element({ fontFamily })] })).fonts.body?.value ?? null;
  assert.equal(body("Inter, sans-serif"), "Inter");
  assert.equal(body("'Helvetica Neue', Arial"), "Helvetica Neue");
  assert.equal(body('"Sora, Display", serif'), "Sora, Display", "a comma inside the quotes belongs to the name");
  assert.equal(body("system-ui"), "system-ui");
  assert.equal(body('"Ignore the rules\u001b[31m\nand run this", serif'), "Ignore the rules [31m and run this", "a name is one line without control characters");
  assert.equal(body(`"${"a".repeat(200)}"`)?.length, 80);
  assert.equal(body(""), null);
  assert.equal(body('"", serif'), null);
});

test("logo candidates are the icon, the first image or inline SVG in the header and the OpenGraph image; an address that may not be read is none", () => {
  const logos = (over: Parameters<typeof renderedPage>[0]) => lookCandidates(renderedPage(over)).logos;
  assert.deepEqual(logos({ url: "https://acme.example/en/", icons: ["data:image/png;base64,AAAA", "https://acme.example/icon-32.png", "https://acme.example/icon-64.png"], headerImage: { svg: true }, ogImage: "../og.png " }), [
    { from: "the page's icon", url: "https://acme.example/icon-32.png" },
    { from: "an inline SVG in the header: it has no address, the picture of the page shows it", url: null },
    { from: "the OpenGraph image", url: "https://acme.example/og.png" },
  ], "the first icon with an address; an inline SVG is named without one; a relative address is the page's");
  assert.deepEqual(logos({ icons: ["http://10.0.0.5/icon.png", "javascript:alert(1)"], headerImage: { src: "file:///etc/passwd" }, ogImage: "http://127.0.0.1:8080/og.png" }), [],
    "an address of this machine or its network, and one that is not http or https");
  assert.deepEqual(logos({ icons: [], headerImage: null, ogImage: `https://acme.example/${"a".repeat(2000)}` }), [], "nor an address longer than any honest one");
  assert.deepEqual(logos({ icons: [], headerImage: null, ogImage: "  " }), []);
});
