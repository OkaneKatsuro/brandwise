// Built-in style: the key visual of a launch day, with the headline in the image.
import type { Style } from "../domain.ts";

export const launchAnnouncement: Style = {
  id: "launch-announcement",
  title: "Launch announcement",
  kind: "image",
  aspects: ["4:5", "1:1", "16:9", "9:16"],
  channels: ["linkedin", "threads", "instagram", "facebook", "telegram", "email"],
  slots: {
    product: "What is being launched as it should look in the frame, as a noun phrase. Example: a slim silver laptop showing a glowing terminal window",
    headline: "The words on the image: six words at most, no quotation marks. Example: Deploys in nine seconds",
  },
  prompt: [
    "Launch-day key visual.",
    "In the lower two thirds: {{product}}, lit from behind by one strong light, so that a glow blooms around its edges against a deep, dark gradient background; a low camera angle looking slightly up, fine haze in the air, a few sharp light streaks behind it.",
    "In the upper third: the headline \"{{headline}}\" in large, heavy, tightly spaced sans-serif capitals, centred, with wide margins, spelled exactly as given.",
    "High contrast, cinematic and crisp, the look of a keynote reveal.",
    "Nothing else is written anywhere. No people, no second line of text, no logos, no watermark, no clutter.",
  ].join(" "),
  models: { higgsfield: "nano_banana_pro" },
  version: 1,
  use: "The day something ships: a product launch, a major version, a waiting list that opens. One image that says it is new and it is out.",
  copy: "First line: what launched and for whom, in plain words. Then the problem it removes, what is new in three short lines, and one link. Say \"today\" and thank the people who helped.",
  avoid: "Headlines over six words or with punctuation: long text gets misspelled, so read the headline on the result before it goes to the calendar. Dates, prices or claims in the headline that are not in the pack's claims. Minor updates: use changelog-post.",
};
