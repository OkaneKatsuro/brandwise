// Built-in style: the product alone, photographed as the hero of the frame.
import type { Style } from "../domain.ts";

export const productHero: Style = {
  id: "product-hero",
  title: "Product hero shot",
  kind: "image",
  aspects: ["4:5", "1:1", "16:9"],
  channels: ["linkedin", "instagram", "facebook", "threads", "telegram", "email"],
  slots: {
    subject: "The product as it appears in the frame, as a noun phrase: the object, or the device and what its screen shows. Example: a 14-inch laptop showing a dark analytics dashboard with one rising line chart",
    setting: "The surface it stands on and what surrounds it, as a noun phrase. Example: a pale oak desk beside a ceramic cup, by a window",
  },
  prompt: [
    "Editorial product photograph of {{subject}}, the single hero of the frame. Setting: {{setting}}.",
    "Three-quarter view from slightly above, 85mm lens at f/4: the product sharp from edge to edge, the background falling softly out of focus.",
    "One large soft key light from the upper left, a thin cool rim light that separates the product from the background, a natural contact shadow that grounds it.",
    "The product fills about half of the frame and sits on the lower right third; the upper left stays clean and uncluttered.",
    "Restrained palette of two or three colours, true materials, crisp reflections, anything on a screen flat and legible.",
    "No people, no hands, no added text or captions, no logos, no watermark.",
  ].join(" "),
  models: { higgsfield: "nano_banana_pro" },
  version: 1,
  use: "The product itself is the news: a launch, a redesign, a profile header, the first image of a landing page or an e-mail. One strong picture of the product and nothing else.",
  copy: "Open with what the product does for the reader in one line, not with its name. Then one proof (a number, a customer, a before and after) and one call to action with the link. Three short paragraphs at most.",
  avoid: "A feature list in the subject: one object, one screen. An invented interface: when the screen matters, pass the real screenshot with --ref or use product-screen. Text in the image: the headline belongs in the post.",
};
