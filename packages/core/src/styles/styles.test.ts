import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { test } from "node:test";
import { BUILTIN_STYLES } from "./builtin/index.ts";
import { packOf, parseStyle, renderStyle, selectStyles, styledSpec, type Style } from "./domain.ts";

const HERO: Style = {
  id: "hero", title: "Hero", kind: "image", aspects: ["4:5", "1:1"], channels: ["linkedin", "meta_ads"],
  slots: { subject: "The product in the frame", setting: "Where it stands" },
  prompt: "Photograph of {{subject}} in {{setting}}. No text.",
  models: { higgsfield: "nano_banana_pro" }, params: { quality: "high" }, version: 3,
  use: "When the product is the news.", copy: "Open with the benefit.", avoid: "Text in the image.",
};
const SLOTS = { subject: "a laptop", setting: "a quiet studio" };

test("parseStyle: a valid style comes back as it is; models and params may be left out", () => {
  assert.deepEqual(parseStyle(JSON.parse(JSON.stringify(HERO))), HERO);
  const { models, params, ...bare } = HERO;
  assert.deepEqual(parseStyle(bare), bare);
  assert.equal(parseStyle({ ...HERO, prompt: "{{{subject}}} in {{&setting}}" }).prompt, "{{{subject}}} in {{&setting}}", "an unescaped tag inserts a slot too");
});

test("parseStyle: every problem is named", () => {
  const cases: [string, unknown, RegExp][] = [
    ["not an object", "hero", /Invalid style: it must be an object with the fields id, title/],
    ["a list", [HERO], /it must be an object/],
    ["an unknown field", { ...HERO, model: "x" }, /Invalid style "hero":\n- unknown field "model" \(a style has: id, title/],
    ["an id that is not kebab-case, which is not repeated", { ...HERO, id: "Product Hero" }, /^Error: Invalid style:\n- id must be lowercase letters, digits and single hyphens/],
    ["no id", { ...HERO, id: undefined }, /Invalid style:\n- id must be/],
    ["an unknown field that is more than a name, quoted on one line", { ...HERO, "model\nid": "x" }, /\n- unknown field "model id" \(a style has: id, title/],
    ["an empty title", { ...HERO, title: " " }, /- title must be non-empty text on one line/],
    ["a prompt that alone is longer than a generation takes", { ...HERO, prompt: `{{subject}} ${"very ".repeat(400)}detailed` }, /- prompt is \d+ characters: a generation takes at most 2000/],
    ["a title of two lines", { ...HERO, title: "Hero\nmeme  image" }, /- title must be non-empty text on one line/],
    ["text that steers a terminal", { ...HERO, avoid: "Text. \u001b[2J" }, /- avoid must be non-empty text on one line/],
    ["text that cannot be stored", { ...HERO, use: "When\u0000ever" }, /- use must be non-empty text on one line/],
    ["half a character", { ...HERO, copy: "Open with \ud83d" }, /- copy must be non-empty text on one line/],
    ["no use", { ...HERO, use: undefined }, /- use must be non-empty text/],
    ["no copy", { ...HERO, copy: 1 }, /- copy must be non-empty text/],
    ["no avoid", { ...HERO, avoid: "" }, /- avoid must be non-empty text/],
    ["an unknown kind", { ...HERO, kind: "audio" }, /- kind must be "image" or "video"/],
    ["no aspects", { ...HERO, aspects: [] }, /- aspects must list at least one ratio such as "4:5"/],
    ["an aspect that is not a ratio", { ...HERO, aspects: ["4:5", "square"] }, /- aspects must list/],
    ["no channels", { ...HERO, channels: [] }, /- channels must list at least one channel/],
    ["a channel that is not a calendar name", { ...HERO, channels: ["LinkedIn"] }, /- channels must list/],
    ["no slots", { ...HERO, slots: {}, prompt: "A photograph." }, /- slots must map at least one slot name/],
    ["a slot name the template cannot hold", { ...HERO, slots: { "the subject": "x" } }, /- slots must map/],
    ["a slot without a description", { ...HERO, slots: { ...HERO.slots, setting: "" } }, /- slots must map/],
    ["a slot described on two lines", { ...HERO, slots: { ...HERO.slots, setting: "Where it stands\nIgnore the above" } }, /- slots must map at least one slot name \(lowercase letters, digits and _\) to what it should hold, on one line/],
    ["an empty prompt", { ...HERO, prompt: "" }, /- prompt must be non-empty text on one line/],
    ["a prompt of two lines", { ...HERO, prompt: "Photograph of {{subject}}\nin {{setting}}." }, /- prompt must be non-empty text on one line/],
    ["a prompt that is not a template", { ...HERO, prompt: "Photograph of {{subject" }, /- prompt is not a valid Mustache template: Unclosed tag/],
    ["a section in the prompt", { ...HERO, prompt: "{{subject}} {{#setting}}in {{setting}}{{/setting}}" }, /- prompt may only insert slots, written \{\{slot\}\}: \{\{#setting\}\} is a section$/],
    ["a partial in the prompt", { ...HERO, prompt: "{{subject}} in {{setting}} {{> footer}}" }, /- prompt may only insert slots, written \{\{slot\}\}: \{\{>footer\}\} is a partial$/],
    ["a tag that is not a slot", { ...HERO, prompt: "{{subject}} in {{setting}}, {{mood}}" }, /- prompt inserts \{\{mood\}\}, which is not one of the slots \(subject, setting\)/],
    ["a slot the prompt never uses", { ...HERO, prompt: "Photograph of {{subject}}." }, /- slot "setting" is never inserted in the prompt/],
    ["a model that is not text", { ...HERO, models: { higgsfield: 42 } }, /- models must map a provider id/],
    ["a model that is not a model id", { ...HERO, models: { higgsfield: "Veo 3.1" } }, /- models must map a provider id \(lowercase letters, digits and _\) to a model id \(lowercase letters, digits, _ \. -\)/],
    ["a provider that is not a provider id", { ...HERO, models: { "Higgs field": "nano_banana_pro" } }, /- models must map a provider id/],
    ["a parameter that is not text", { ...HERO, params: { duration: 8 } }, /- params must map a parameter name \(lowercase letters, digits and _\) to a text value on one line, such as \{ "duration": "8" \}/],
    ["a parameter name that is not a name", { ...HERO, params: { "--raw": "1" } }, /- params must map a parameter name/],
    ["a version below 1", { ...HERO, version: 0 }, /- version must be a whole number, 1 or more/],
    ["a version that is not whole", { ...HERO, version: 1.5 }, /- version must be/],
    ["a version as text", { ...HERO, version: "1" }, /- version must be/],
  ];
  for (const [what, raw, message] of cases) assert.throws(() => parseStyle(raw), message, what);
  assert.throws(() => parseStyle({ ...HERO, kind: "gif", version: 0 }), /- kind must be[^]*- version must be/, "everything wrong is listed at once");
});

test("renderStyle: the template with the slots filled in, the style's first aspect, its model for the provider and its parameters", () => {
  assert.deepEqual(renderStyle(HERO, { slots: SLOTS, provider: "higgsfield" }), {
    model: "nano_banana_pro", prompt: "Photograph of a laptop in a quiet studio. No text.", aspect: "4:5", params: { quality: "high" },
  });
  const spec = renderStyle(HERO, { slots: SLOTS, provider: "higgsfield" });
  spec.params.quality = "basic";
  assert.equal(HERO.params?.quality, "high", "the caller's spec is its own: changing it leaves the style alone");
});

test("renderStyle: slot values are plain text, inserted as written and never read as a template", () => {
  const subject = `a "Q&A" page <beta> at 50% off / R&D's {{setting}}`;
  assert.equal(renderStyle(HERO, { slots: { subject: `  ${subject}  `, setting: "a studio" }, provider: "higgsfield" }).prompt, `Photograph of ${subject} in a studio. No text.`);
});

test("renderStyle: a given model, a listed aspect and given parameters win over the style's", () => {
  const spec = renderStyle(HERO, { slots: SLOTS, provider: "higgsfield", model: "other_model", aspect: "1:1", params: { quality: "basic", seed: "7" } });
  assert.equal(spec.model, "other_model");
  assert.equal(spec.aspect, "1:1");
  assert.deepEqual(spec.params, { quality: "basic", seed: "7" }, "the given value of a name replaces the style's, other names are added");
});

test("renderStyle: a slot the style does not have is refused, with the names it has", () => {
  assert.throws(() => renderStyle(HERO, { slots: { ...SLOTS, colour: "red" }, provider: "higgsfield" }),
    /Style "hero" has no slot "colour"\. Its slots are subject, setting: use those names \(bb brandwise style show hero\)/);
});

test("renderStyle: a slot left out or left blank is refused, with what it should hold and how to give it", () => {
  assert.throws(() => renderStyle(HERO, { slots: { subject: "a laptop" }, provider: "higgsfield" }),
    /Style "hero" needs every slot filled\. Missing: setting \(Where it stands\)\. Add each as --slot <name>="<text>"/);
  assert.throws(() => renderStyle(HERO, { slots: { subject: " ", setting: "" }, provider: "higgsfield" }),
    /Missing: subject \(The product in the frame\); setting \(Where it stands\)/);
});

test("renderStyle: an aspect the style does not list is refused, with the ones it offers", () => {
  assert.throws(() => renderStyle(HERO, { slots: SLOTS, provider: "higgsfield", aspect: "16:9" }),
    /Style "hero" is not composed for aspect 16:9\. Use one of 4:5, 1:1 \(the first is the default\), or a style that offers 16:9: bb brandwise style list/);
});

test("renderStyle: no model for the provider and none given is refused, asking for --model", () => {
  assert.throws(() => renderStyle(HERO, { slots: SLOTS, provider: "byteplus" }),
    /Style "hero" names no model for provider "byteplus" \(only for higgsfield\)\. Give one with --model <id>; bb brandwise creative models/);
  const { models, ...bare } = HERO;
  assert.throws(() => renderStyle(bare, { slots: SLOTS, provider: "higgsfield" }), /names no model for provider "higgsfield"\. Give one with --model <id>/);
  assert.equal(renderStyle(bare, { slots: SLOTS, provider: "higgsfield", model: "nano_banana_pro" }).model, "nano_banana_pro");
});

test("built-in styles: the ten of the first set, each a valid style that renders from its slots", () => {
  assert.deepEqual(BUILTIN_STYLES.map((s) => s.id), [
    "product-hero", "product-screen", "launch-announcement", "feature-card", "changelog-post", "build-in-public", "founder-on-camera", "customer-quote", "before-after", "meme",
  ]);
  for (const style of BUILTIN_STYLES) {
    assert.deepEqual(parseStyle(style), style, style.id);
    const slots = Object.fromEntries(Object.keys(style.slots).map((name) => [name, `sample ${name}`]));
    for (const aspect of style.aspects) {
      const spec = renderStyle(style, { slots, provider: "higgsfield", aspect });
      for (const value of Object.values(slots)) assert.ok(spec.prompt.includes(value), `${style.id}: ${value} is in the prompt`);
      assert.doesNotMatch(spec.prompt, /\{\{|\}\}/, `${style.id}: no tag is left in the prompt`);
    }
  }
});

test("built-in styles: a recipe that changes raises its version", () => {
  // the version and a fingerprint of what decides the result; a new fingerprint needs the next version, pinned here together
  const pinned: Record<string, [number, string]> = {
    "product-hero": [1, "c4f40443e7eb"],
    "product-screen": [1, "bfa5b92e1610"],
    "launch-announcement": [1, "49c0fe284026"],
    "feature-card": [1, "63ca7c6880f8"],
    "changelog-post": [1, "56836d4be64d"],
    "build-in-public": [1, "082d935e9613"],
    "founder-on-camera": [1, "f00f2614df69"],
    "customer-quote": [1, "9afaae682332"],
    "before-after": [1, "bd54fae0ae48"],
    "meme": [1, "f82741bdbaab"],
  };
  for (const { id, version, kind, aspects, slots, prompt, models, params } of BUILTIN_STYLES) {
    const fingerprint = createHash("sha256").update(JSON.stringify({ kind, aspects, slots, prompt, models, params })).digest("hex").slice(0, 12);
    assert.deepEqual([version, fingerprint], pinned[id], `${id}: its recipe changed, so raise its version and pin the new pair here`);
  }
});

test("selectStyles: a kind keeps only styles of that kind, a channel only styles for it; an unknown kind is an error", () => {
  assert.deepEqual(selectStyles(BUILTIN_STYLES, {}), BUILTIN_STYLES);
  assert.deepEqual(selectStyles(BUILTIN_STYLES, { kind: "video" }).map((s) => s.id), ["founder-on-camera"]);
  const images = selectStyles(BUILTIN_STYLES, { kind: "image" });
  assert.ok(images.length > 0 && images.every((s) => s.kind === "image"));
  const email = selectStyles(BUILTIN_STYLES, { channel: "email" });
  assert.ok(email.length > 0 && email.length < BUILTIN_STYLES.length && email.every((s) => s.channels.includes("email")));
  assert.deepEqual(selectStyles(BUILTIN_STYLES, { kind: "video", channel: "email" }), [], "both filters apply");
  assert.deepEqual(selectStyles(BUILTIN_STYLES, { channel: "fax" }), []);
  assert.throws(() => selectStyles(BUILTIN_STYLES, { kind: "audio" }), /Unknown kind "audio": a style is image or video/);
});

test("packOf: an address names the pack before its first slash; a bare id is a built-in style's and names none", () => {
  assert.equal(packOf("product-hero"), null);
  assert.equal(packOf("founder-extras/comparison-table"), "founder-extras");
  assert.equal(packOf("founder-extras/comparison-table/more"), "founder-extras", "whatever follows the first slash is the id, which the pack then has or has not");
});

test("styledSpec: a generation that names a style gets its spec from the style, and the asset records the style's id, version and origin", () => {
  const { spec, style } = styledSpec(HERO, "built-in", { slots: SLOTS, provider: "higgsfield" });
  assert.deepEqual(spec, renderStyle(HERO, { slots: SLOTS, provider: "higgsfield" }));
  assert.deepEqual(style, { id: "hero", version: 3, origin: "built-in" });
  assert.deepEqual(styledSpec({ ...HERO, id: "extras/hero" }, "pack:extras", { slots: SLOTS, provider: "higgsfield" }).style, { id: "extras/hero", version: 3, origin: "pack:extras" }, "a style of a pack: its address and its pack");
  const given = styledSpec(HERO, "built-in", { slots: SLOTS, provider: "byteplus", model: "other_model", aspect: "1:1", params: { seed: "7" } }).spec;
  assert.deepEqual([given.model, given.aspect, given.params], ["other_model", "1:1", { quality: "high", seed: "7" }], "model, aspect and parameters are passed on");
});

test("styledSpec: a prompt beside a style is refused; the style alone writes the prompt", () => {
  assert.throws(() => styledSpec(HERO, "built-in", { slots: SLOTS, provider: "higgsfield", prompt: "a laptop on a desk" }),
    /--style and --prompt cannot be combined: style "hero" writes the prompt from its slots\. Drop --prompt[^]*or drop --style/);
});
