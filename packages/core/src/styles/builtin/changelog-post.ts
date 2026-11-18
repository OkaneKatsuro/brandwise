// Built-in style: release notes as a code-editor window with three lines.
import type { Style } from "../domain.ts";

export const changelogPost: Style = {
  id: "changelog-post",
  title: "Changelog post",
  kind: "image",
  aspects: ["4:5", "1:1", "16:9"],
  channels: ["linkedin", "threads", "telegram", "email"],
  slots: {
    version: "The release label in the title bar: a version or a month, no quotation marks. Example: v2.4",
    changes: "Exactly three changes, each five words at most, separated by semicolons. Example: Faster cold starts; SSO for teams; Dark mode",
  },
  prompt: [
    "Release-notes card that looks like a tidy code-editor window, seen flat from the front on a dark background.",
    "A rounded window with three small control dots at its top left and a thin title bar that reads \"{{version}}\".",
    "Inside, in a clean monospaced typeface, a list of exactly these lines, each on its own row and each starting with a green plus sign: {{changes}}.",
    "The text is large, left aligned, with comfortable line spacing, spelled exactly as given, in two or three soft syntax-highlight colours.",
    "A faint glow behind the window and a soft shadow for depth. The window is centred and fills about 80% of the frame.",
    "Nothing else is written anywhere. No people, no extra code, no placeholder text, no logos, no watermark.",
  ].join(" "),
  models: { higgsfield: "nano_banana_pro" },
  version: 1,
  use: "Regular shipping updates: a release, a weekly or monthly changelog, the top of a release e-mail. It shows momentum without a new visual idea each time.",
  copy: "Open with the release label and the one change most people asked for. List the changes as short lines that start with a verb (Added, Fixed, Faster), the three on the image first. Close with the link to the full changelog.",
  avoid: "More than three lines, or lines over five words: small text gets misspelled, so read every line on the result. Ticket numbers and internal jargon. Changes that have not shipped.",
};
