---
name: creative-styles
description: Choose and use BrandWise style recipes for creatives with `bb brandwise style` and `creative generate --style`. Use before generating an image or a video for a post, a launch, a feature, a changelog, a customer quote, a meme or a founder video, and when asked which styles exist or for a new one.
---

# Creative styles

A style is a recipe for one kind of creative, shared by every company: a prompt template written once, with a few slots that you fill. Code renders the template, sets the model and the aspect, and records the style in the asset, so results can later be compared by style. What makes the result the company's own is what goes into the slots.

| Command | Effect |
| --- | --- |
| `bb brandwise style list [--kind image\|video] [--channel <c>]` | The styles: id, kind, aspects, channels and what each is for. |
| `bb brandwise style show <id>` | Everything needed to use one: its slots and what each should hold, aspects, channels, model, the post text that goes with it, what to avoid. |
| `bb brandwise creative cost --style <id> --slot <name>="<text>"... [--campaign <c>]` | The price of that generation; spends nothing. |
| `bb brandwise creative generate --style <id> --slot <name>="<text>"... --campaign <c> [--aspect ..] [--name <n>]` | Generates it. Cost check, limits, waiting and `creative collect` work as the brandwise skill describes. |

## Choosing a style

1. Start from the goal of the post, not from the picture: what should the reader know or do afterwards? `style list --channel <channel of the entry>` shows the styles that suit the channel; the line under each says when it fits.
2. Read `style show <id>` before you use a style. `Use` says when it fits, `Avoid` when it does not. If two fit, take the one whose `Use` names the situation more exactly.
3. Take the aspect from the channel: 9:16 for reels, stories and TikTok, 4:5 or 1:1 for feeds, 16:9 for YouTube and link cards. Without `--aspect` the style's first aspect is used. An aspect the style does not list is refused: pick another style, do not force this one.

## Filling the slots

1. Read the product pack first: `bb brandwise product get product.md --campaign <c>`, then `audience.md`, `claims.md`, `constraints.md` and `voice.md`. The subject, the scene and the words on the image come from there, not from your imagination.
2. Every slot is required and no other name is accepted. Write each value in the form the slot asks for (a noun phrase, six words at most, exactly three changes): the template puts it into a sentence as it is.
3. Words that end up in the image or in speech (headlines, changelog lines, a spoken line) must be covered by `claims.md` and allowed by `constraints.md`. A customer's quote is used word for word or not at all. Keep them as short as the slot says: long text gets misspelled.
4. Slot values are plain text. Do not wrap them in quotation marks and do not add instructions for the model ("make it pop", "8k"): the template already carries composition, light and what to leave out.
5. Give `--name <short name>`. Without it the asset is named after the first words of the prompt, and those are the opening of the template: creatives of one style would be hard to tell apart by name.

Media flags work with a style as they do without one: `--ref <file>` for the real screenshot in `product-screen`, `--start-image <file>` for the approved still of a person in `founder-on-camera`. `--model`, `--duration` and `--param` replace what the style sets: use them when the user asks, or when the error says the style names no model for the campaign's provider (`creative models` lists what it offers).

## After generating

- Look at the result before you show it and read every word in the image. If one is wrong, generate again with shorter text; never pass on a misspelled creative.
- Show it with `::creative{ids="<asset-id>"}` and write the post text after the style's `Post text` pattern, in the company's voice.
- The asset id goes into `calendar add --asset <id>`; nothing is published any other way.

## Rules

- Never paste a style's template into `--prompt` to change it. `--style` together with `--prompt` is refused, and a creative made from an edited copy is not recorded as the style, so nobody can tell later what worked. If a template needs a change, tell the user what and why.
- When no style fits, do not bend one. Tell the user which need is not covered and propose a new style: its id, what it is for, its slots, the composition in two or three sentences and what to avoid, with everything specific to one company left to the slots. Until it exists, a one-off `creative generate --prompt` is fine, said as such.
