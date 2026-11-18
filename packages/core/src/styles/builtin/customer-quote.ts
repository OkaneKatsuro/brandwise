// Built-in style: a customer's own words as a typographic card.
import type { Style } from "../domain.ts";

export const customerQuote: Style = {
  id: "customer-quote",
  title: "Customer quote",
  kind: "image",
  aspects: ["1:1", "4:5"],
  channels: ["linkedin", "instagram", "facebook", "threads", "email"],
  slots: {
    quote: "The customer's words exactly as approved: twenty words at most, no quotation marks",
    attribution: "Who said it, as it may be published: name, role, company. Example: Dana Whitfield, CTO, Loopwork",
  },
  prompt: [
    "Testimonial card in a calm editorial layout, seen flat from the front.",
    "A soft off-white background with a fine paper texture and wide margins.",
    "Top left: one oversized opening quotation mark in a muted accent colour.",
    "Below it, in a large, elegant serif typeface, left aligned on three to five lines, the quotation exactly as written: \"{{quote}}\"",
    "Under it a short thin rule, then in a small clean sans-serif: {{attribution}}.",
    "Every word is spelled exactly as given and nothing is added.",
    "The right quarter of the card stays empty, except for one soft abstract shape in the accent colour that runs off the edge.",
    "Even light, print-quality typography. No portrait, no invented face, no star rating, no logos, no other text, no watermark.",
  ].join(" "),
  models: { higgsfield: "nano_banana_pro" },
  version: 1,
  use: "Proof in the customer's own words: after a launch, with a case study, in a nurture e-mail. Only with a quote the customer approved for publication.",
  copy: "Start with the result the customer got, in one line. Then the situation before in one sentence, and the point of the quote in your own words without repeating it. Name the customer as they agreed and link the full story.",
  avoid: "Paraphrased, shortened or invented quotes: the words are the customer's or they are not used. Quotes over twenty words. A generated portrait of the customer. A name, role or company the customer did not approve.",
};
