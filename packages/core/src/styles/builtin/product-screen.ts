// Built-in style: the product's interface, framed by a device on a studio backdrop.
import type { Style } from "../domain.ts";

export const productScreen: Style = {
  id: "product-screen",
  title: "Product screen showcase",
  kind: "image",
  aspects: ["16:9", "1:1", "4:5"],
  channels: ["linkedin", "threads", "facebook", "instagram", "telegram", "email"],
  slots: {
    screen: "What the interface shows, as a noun phrase that names the one element the eye should land on. Example: a kanban board with three columns and one highlighted card",
    device: "What frames the interface, as a noun phrase: a browser window, a laptop, a phone or a tablet",
  },
  prompt: [
    "Clean product showcase: {{device}} displaying {{screen}}.",
    "The interface is the hero: flat, sharp and legible, in true proportions, with no glare or reflection across the screen.",
    "The device is seen almost straight on with a slight turn to the left, floating a little above a smooth seamless studio backdrop in a soft gradient, a faint contact shadow beneath it.",
    "Even, diffused light from above, no hard highlights.",
    "The device is centred and fills about 70% of the frame width, with equal calm margins on every side.",
    "Minimal and precise, like the product page of a design-led software company.",
    "No hands, no people, no desk props, no text outside the screen, no logos, no watermark.",
  ].join(" "),
  models: { higgsfield: "nano_banana_pro" },
  version: 1,
  use: "Showing what the product looks like: a new screen, a redesign, a walkthrough carousel, a feature that is easier seen than told. Pass the real screenshot with --ref <file>, so the interface in the image is the real one.",
  copy: "Name the job the screen does in the first line (\"Every open incident, one view\"). Then two or three things to look for in the image, as short lines. End with where to try it.",
  avoid: "Generating without the real screenshot as --ref when accuracy matters: the model invents plausible but wrong interface details. Screens that show customer data or secrets. More than one device in the frame.",
};
