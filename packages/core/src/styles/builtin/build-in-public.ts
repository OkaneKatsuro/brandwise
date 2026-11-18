// Built-in style: a candid picture of the founder's workspace in the middle of the work.
import type { Style } from "../domain.ts";

export const buildInPublic: Style = {
  id: "build-in-public",
  title: "Build-in-public update",
  kind: "image",
  aspects: ["4:5", "1:1", "16:9"],
  channels: ["linkedin", "threads", "instagram", "telegram"],
  slots: {
    scene: "What is on the desk and on the screen, as a noun phrase with real details of the work. Example: a laptop with a terminal and a failing test, a notebook with a hand-drawn funnel, a cold coffee",
    moment: "The time of day and the light, as a phrase. Example: late evening, one warm desk lamp, city lights in the window",
  },
  prompt: [
    "Candid documentary photograph of a founder's real workspace: {{scene}}. The moment: {{moment}}.",
    "Shot over the shoulder at seated eye level on a 35mm lens, shallow depth of field, the work in focus and the room falling soft.",
    "Available light only, natural colour, light film grain, honest imperfections such as cables, sticky notes and fingerprints on the screen.",
    "If a person is in the frame, only from behind or as hands on the keyboard, never a face.",
    "The upper third stays calm and dark enough for a caption. Unposed and quiet, in the middle of the work.",
    "No staged props, no stock-photo smiles, no text overlays, no logos, no watermark.",
  ].join(" "),
  models: { higgsfield: "nano_banana_pro" },
  version: 1,
  use: "Progress, numbers, lessons and setbacks told in the first person: a milestone, a hard week, a decision explained. The picture says that a person is building this.",
  copy: "First person, with one specific fact in the first line (a number, a date, a mistake). Then what happened, what was learned and what is next, in short paragraphs. End with a question or an ask, not with a pitch.",
  avoid: "Passing the image off as a photograph: it is generated and the post says so. A real photo of the actual desk is better whenever there is one. Revenue or user numbers on the screen that are not true.",
};
