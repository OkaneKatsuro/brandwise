// Built-in style: a caption above a snapshot, an original picture and never a known template.
import type { Style } from "../domain.ts";

export const meme: Style = {
  id: "meme",
  title: "Meme",
  kind: "image",
  aspects: ["1:1", "4:5"],
  channels: ["threads", "linkedin", "instagram", "telegram", "facebook"],
  slots: {
    caption: "The line above the picture: ten words at most, no quotation marks. Example: When the demo works on the first try",
    scene: "The picture that lands the joke, as a noun phrase: an ordinary person or object in a situation the audience knows. Example: a developer staring at a laptop in disbelief, arms raised",
  },
  prompt: [
    "Internet meme in the caption-above-photo format.",
    "Top fifth of the frame: a plain white band with the caption \"{{caption}}\" in bold black sans-serif, centred, on at most two lines, spelled exactly as given.",
    "Below it, filling the rest of the frame: {{scene}}, photographed like a casual snapshot with direct flash, slightly off-centre, in ordinary everyday surroundings, with an exaggerated but believable expression or pose that carries the joke at a glance.",
    "Deliberately unpolished, so that it reads as a meme and not as an advertisement.",
    "One caption only. No brand logos, no celebrities or recognisable real people, no existing meme characters or film stills, no watermark, no other text.",
  ].join(" "),
  models: { higgsfield: "nano_banana_pro" },
  version: 1,
  use: "A pain the audience shares, said as a joke: founders, developers, the reader's own job. For reach and replies between heavier posts, never for an announcement.",
  copy: "One short line that adds to the joke, or nothing at all; never explain it. No link and no pitch in the post itself; the product may appear in a reply.",
  avoid: "Known meme templates, film stills and famous faces: they belong to someone else. Jokes at the expense of customers, of competitors by name or of any group of people. Captions over ten words. A joke about an outage or a mistake that hurt users.",
};
