// Built-in style: the same subject without and with the product, side by side.
import type { Style } from "../domain.ts";

export const beforeAfter: Style = {
  id: "before-after",
  title: "Before and after",
  kind: "image",
  aspects: ["1:1", "16:9"],
  channels: ["linkedin", "instagram", "facebook", "threads", "telegram"],
  slots: {
    before: "The situation without the product as a scene to show, as a noun phrase. Example: a desk buried in printed invoices and a spreadsheet full of red cells",
    after: "The same situation with the product, as a noun phrase. Example: the same desk cleared, one laptop showing a single green dashboard",
  },
  prompt: [
    "Split-screen comparison, divided exactly down the middle by a thin white vertical line.",
    "Left half, with a small plain tag that reads \"Before\" in its top corner: {{before}}, in cool, dim, desaturated light, crowded and tense.",
    "Right half, with a matching tag that reads \"After\": {{after}}, in warm, bright, clean light, ordered, with room to breathe.",
    "Both halves show the same subject from the same camera angle, at the same scale and with the same framing, so that only the change differs.",
    "Straight-on view, 50mm look, sharp across the frame.",
    "Only the two tags are written. No other text, no arrows, no faces, no logos, no watermark.",
  ].join(" "),
  models: { higgsfield: "nano_banana_pro" },
  version: 1,
  use: "A change the reader sees at a glance: a workflow made simple, a screen redesigned, time or clutter removed. It works when the difference is visual, not when it is a number.",
  copy: "The first line names the pain on the left in the reader's words, the second what changed. Then how long the change takes or what it costs, and one link. Claim only what the picture shows.",
  avoid: "A before that mocks the reader or a named competitor. An after that promises a result the product does not deliver or that is not in the pack's claims. Different subjects in the two halves: the comparison reads only when everything but the change is the same.",
};
