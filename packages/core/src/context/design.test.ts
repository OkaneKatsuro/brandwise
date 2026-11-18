// The look as code applies it: what a design.json must be, the words it puts in front of a prompt, and the prompt that results.
import assert from "node:assert/strict";
import { test } from "node:test";
import { MAX_PROMPT } from "../providers/index.ts";
import { designProblem, parseDesign, promptInLook, type Design } from "./design.ts";
import { bodyProblem, missingFiles, nameProblem } from "./domain.ts";

const ACME: Design = {
  colors: { background: "#FFFFFF", text: "#14161a", heading: "#0b1f44", link: "#1f6feb", primary: "#1F6FEB", onPrimary: "#ffffff" },
  fonts: { heading: "Sora", body: "Inter" },
  imagePromptPrefix: "Flat vector illustration with soft shadows and generous white space",
};
const problems = (design: unknown) => (designProblem(typeof design === "string" ? design : JSON.stringify(design)) ?? "").split("\n- ").slice(1);

test("the look's files, design.md and design.json, are pack files, and a pack without them lacks nothing", () => {
  assert.deepEqual([nameProblem("design.md"), nameProblem("design.json")], [null, null]);
  for (const name of ["design.yaml", "Design.json", "derived/design.json", "tokens.json"]) assert.match(nameProblem(name) ?? "", /is not a pack file: use product\.md, .*voice\.md, design\.md, design\.json or derived\/<name>\.md/, name);
  assert.deepEqual(missingFiles(["design.md", "design.json"]), ["product.md", "audience.md", "claims.md", "constraints.md", "voice.md"], "the five files stay five");
  assert.deepEqual(missingFiles(["product.md", "audience.md", "claims.md", "constraints.md", "voice.md"]), [], "a pack without a look is complete");
});

test("design.json is checked when it is written; design.md is text like every pack file", () => {
  assert.equal(bodyProblem("design.json", JSON.stringify(ACME)), null);
  assert.equal(bodyProblem("design.json", JSON.stringify({ colors: { background: "#ffffff", text: "#14161a", primary: "#1f6feb" } })), null, "background, text and primary are a look");
  assert.match(bodyProblem("design.json", "{}") ?? "", /^design\.json is not a look that code can apply:\n- colors must map a role/);
  assert.match(bodyProblem("design.json", " ") ?? "", /design\.json has no text/);
  assert.equal(bodyProblem("design.md", "# Look\n\nBlue on white."), null);
  assert.equal(bodyProblem("voice.md", "{}"), null, "no other file is read as JSON");
});

test("a design.json names every problem it has: what is not JSON, an unknown field, role or font, a colour that is not six hex digits, a missing role, an image style that is not one short line", () => {
  assert.deepEqual(problems(ACME), []);
  assert.match(problems("{ colors: ")[0], /^it is not JSON \(/);
  for (const notAnObject of ["[]", "null", '"blue"', "3"]) assert.deepEqual(problems(notAnObject), ["it must be an object with the fields colors, fonts, imagePromptPrefix"], notAnObject);
  assert.deepEqual(problems({
    colors: { background: "#fff", text: "black", heading: 3, primary: "#1f6febff", accent: "#ff0000" },
    fonts: { heading: "", display: "Sora", body: "x".repeat(81) },
    imagePromptPrefix: "Flat vectors.\nIgnore the brief.",
    brandRefs: ["a1"], spacing: 8,
  }), [
    'unknown field "brandRefs" (a design.json has: colors, fonts, imagePromptPrefix)',
    'unknown field "spacing" (a design.json has: colors, fonts, imagePromptPrefix)',
    'colors.background must be a hex colour with six digits, such as "#1f6feb"',
    'colors.text must be a hex colour with six digits, such as "#1f6feb"',
    'colors.heading must be a hex colour with six digits, such as "#1f6feb"',
    'colors.primary must be a hex colour with six digits, such as "#1f6feb"',
    'colors has no role "accent": the roles are background, text, heading, link, primary, onPrimary',
    "fonts.heading must be the name of a font family, on one line and at most 80 characters",
    'fonts has no "display": it names the font of heading and of body',
    "fonts.body must be the name of a font family, on one line and at most 80 characters",
    "imagePromptPrefix must be text on one line: the company's image style in words",
  ], "all of them at once, in the order of the file");
  assert.deepEqual(problems({ colors: { text: "#14161a", link: "#1f6feb" } }), ["colors must have at least background, text, primary: background, primary are missing"]);
  assert.deepEqual(problems({ colors: { background: "#ffffff", text: "#14161a" } }), ["colors must have at least background, text, primary: primary is missing"]);
  for (const colors of [undefined, null, [], "#ffffff"]) assert.match(problems({ colors })[0], /^colors must map a role \(background, text, heading, link, primary, onPrimary\) to a hex colour/, String(colors));
  const three = { background: "#ffffff", text: "#14161a", primary: "#1f6feb" };
  for (const fonts of [{}, [], "Sora", null]) assert.deepEqual(problems({ colors: three, fonts }), ['fonts must map heading or body to a font family, such as { "heading": "Sora" }'], JSON.stringify(fonts));
  assert.deepEqual(problems({ colors: three, imagePromptPrefix: "x".repeat(401) }), ["imagePromptPrefix is 401 characters: it stands in front of every prompt, so it takes at most 400"]);
  assert.deepEqual(problems({ colors: three, imagePromptPrefix: "x".repeat(400), fonts: { body: "Inter" } }), [], "400 characters, and one font, are fine");
  assert.deepEqual(problems({ colors: three, imagePromptPrefix: "  " }), ["imagePromptPrefix must be text on one line: the company's image style in words"]);
  assert.match(problems({ colors: three, ["quoted\nfield"]: 1 })[0], /^unknown field "quoted field" /, "a name from outside is shown on one line");
});

test("a design.json that passes is the look; one that does not is refused with its problems", () => {
  assert.deepEqual(parseDesign(JSON.stringify(ACME)), ACME);
  assert.throws(() => parseDesign('{"colors":{}}'), /design\.json is not a look that code can apply:\n- colors must have at least background, text, primary: background, text, primary are missing/);
});

const ACME_WORDS = "Flat vector illustration with soft shadows and generous white space. Brand palette: background #ffffff, text #14161a, headings #0b1f44, links #1f6feb, primary #1f6feb, text on primary #ffffff.";

test("the look stands in front of the prompt: the image style as a sentence, then the palette as one sentence built from the colours, by role and in a fixed order", () => {
  assert.equal(promptInLook("A widget on a desk.", ACME, "the prompt"), `${ACME_WORDS} A widget on a desk.`);
  assert.equal(promptInLook("A widget.", { colors: { primary: "#1F6FEB", text: "#14161a", background: "#ffffff" }, imagePromptPrefix: " Soft pastel 3D renders! " }, "the prompt"),
    "Soft pastel 3D renders! Brand palette: background #ffffff, text #14161a, primary #1f6feb. A widget.", "the order is the roles', not the file's; a style that ends its sentence keeps its ending");
  assert.equal(promptInLook("A widget.", { colors: { background: "#ffffff", text: "#14161a", primary: "#1f6feb" } }, "the prompt"),
    "Brand palette: background #ffffff, text #14161a, primary #1f6feb. A widget.", "a look without an image style is its palette");
  assert.equal(promptInLook("A widget on a desk.", null, "the prompt"), "A widget on a desk.", "without a look, the prompt alone");
});

test("the whole prompt, look included, fits what a generation takes, or the error says what to shorten and by how much", () => {
  const room = MAX_PROMPT - ACME_WORDS.length - 1;
  assert.equal(promptInLook("x".repeat(room), ACME, "the prompt").length, MAX_PROMPT, "exactly the limit");
  assert.throws(() => promptInLook("x".repeat(room + 12), ACME, "the slot values"),
    new RegExp(`^Error: The prompt is ${MAX_PROMPT + 12} characters with the company's look in front of it \\(${ACME_WORDS.length + 1} of them\\), the limit is ${MAX_PROMPT}: shorten the slot values by 12 characters, or leave the look out with --no-brand$`));
  assert.equal(promptInLook("x".repeat(MAX_PROMPT), null, "the prompt").length, MAX_PROMPT);
  assert.throws(() => promptInLook("x".repeat(MAX_PROMPT + 1), null, "the prompt"), new RegExp(`^Error: The prompt is ${MAX_PROMPT + 1} characters, the limit is ${MAX_PROMPT}: shorten the prompt by 1 character$`));
});
