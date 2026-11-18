// Built-in style: one feature on one card, a headline and a simple illustration.
import type { Style } from "../domain.ts";

export const featureCard: Style = {
  id: "feature-card",
  title: "Feature card",
  kind: "image",
  aspects: ["4:5", "1:1"],
  channels: ["linkedin", "instagram", "threads", "facebook", "telegram", "email"],
  slots: {
    feature: "The feature as the headline on the card: five words at most, no quotation marks. Example: One-click rollbacks",
    visual: "One simple object or interface fragment that shows the feature, as a noun phrase. Example: a toggle switch flipped to on beside a clock with its hands turning back",
  },
  prompt: [
    "Minimal feature card in flat editorial design.",
    "A solid, calm background colour with very subtle grain.",
    "Top left: the headline \"{{feature}}\" in large bold sans-serif, left aligned, on at most two lines, spelled exactly as given.",
    "Lower right two thirds: {{visual}}, drawn as a clean, slightly isometric 3D illustration from simple geometric forms, in at most three colours plus white, softly and evenly lit, with one soft shadow.",
    "Strict grid, wide margins, generous empty space between the headline and the illustration.",
    "Nothing else is written anywhere. No people, no photographic textures, no small print, no logos, no watermark.",
  ].join(" "),
  models: { higgsfield: "nano_banana_pro" },
  version: 1,
  use: "One feature, one benefit: feature posts between launches, a carousel with one card per feature, a section of an e-mail. The card has to read at thumbnail size.",
  copy: "The first line states the benefit, not the feature's name (\"Undo a bad deploy in one click\"). Then how it works in two sentences and what it replaces. One link to the docs or the changelog.",
  avoid: "Two features on one card. Headlines over five words. A visual that needs explaining: if it takes a sentence to decode, pick a simpler object. The real interface: use product-screen for that.",
};
