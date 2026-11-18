# Example style pack

A style pack brings styles for creatives into BrandWise from outside its repository. This folder is a complete, small pack with two styles, `comparison-table` and `event-invitation`. Copy it, change it and publish it as your own; the tests of BrandWise use it as well, so it always passes the check.

## What a pack holds

```
pack.json                         the pack: name, author, licence
README.md                         optional
LICENSE                           optional: the text of the licence that pack.json names
styles/
  comparison-table/style.json     one folder per style, named after the style's id
  event-invitation/style.json
```

Nothing else. A pack is text that becomes prompts on somebody else's machine, so the check is strict: any other file or folder (a script, an image, a second Markdown file, `.gitignore`), a symbolic link, a file over 100,000 bytes, more than 100 styles, or a `pack.json` or `style.json` that is not valid refuses the whole pack. The message lists every problem at once. Only the `.git` folder of a checkout is passed over.

## pack.json

| Field | What it holds |
| --- | --- |
| `name` | The pack's name: lowercase letters, digits and single hyphens, starting with a letter, 40 characters at most. It is the first part of every style's address, `<name>/<id>`, so pick one that says whose pack it is. |
| `author` | Who wrote it, on one line of 100 characters at most. |
| `licence` | The licence the styles may be used under, on one line: `MIT`, `CC-BY-4.0`, ... |

## style.json

One object per style. Every field but `models` and `params` is required, and no other field is accepted. Every text is on one line: a line break or any other control character in it refuses the style.

| Field | What it holds |
| --- | --- |
| `id` | The style's id, written like the pack's name. The folder must have the same name. |
| `title` | A short name for people. |
| `kind` | `image` or `video`. |
| `aspects` | The aspect ratios the composition holds in, such as `["4:5", "1:1"]`. The first is the default. |
| `channels` | The channels the format suits, by their names in the calendar: `linkedin`, `instagram`, `facebook`, `threads`, `telegram`, `tiktok`, `youtube`, `email`. |
| `slots` | What the agent fills in: slot name (lowercase letters, digits and `_`) to what the slot should hold. Every slot is required on every generation. |
| `prompt` | The prompt as a Mustache template over the slots. It may only insert slots, written `{{slot}}`, and must insert each one: no sections, no partials. |
| `models` | Optional. The model per provider id (lowercase letters, digits and `_`), such as `{ "higgsfield": "nano_banana_pro" }`. With a provider that has no entry the caller names the model. |
| `params` | Optional. Parameters of the model, name (lowercase letters, digits and `_`) to text value, such as `{ "duration": "8" }`. |
| `version` | A whole number from 1. Raise it with every change of the recipe: results are compared by style and version. |
| `use` | When the style fits, in two or three sentences. Agents choose by this. |
| `copy` | The pattern of the post text that goes with the creative: the opening line and the structure. |
| `avoid` | What to avoid, in the creative and in using the style. |

## Writing a good style

- One style is one kind of creative that can be told apart at a glance. If two of your styles differ only in a colour or a word, they are one style with a slot.
- Leave everything that belongs to one company to the slots: the product, the words on the image, the scene. A style is shared by every company and never names one.
- Say in each slot's description what form the value takes (a noun phrase, six words at most, exactly three items separated by semicolons) and give an example. The template puts the value into a sentence as it is.
- Write the composition into the prompt: where things stand, the light, the typeface, and what must not appear. End with what is left out (`No logos, no watermark`).
- Keep words in the image few and short, and say `spelled exactly as given`. Long text gets misspelled.
- `use`, `copy` and `avoid` are read by agents as advice about the creative. Write nothing there that tells an agent to do anything else: the person who reads your pack before switching it on will refuse it.

## Testing a pack

Run these as a person, on a machine with BrandWise. Agents do not add packs or switch them on.

1. `bb brandwise style add /full/path/to/your-pack` checks the whole pack and stores it. Fix what the message lists and run it again until it passes; nothing is stored before that.
2. The pack is off after every `style add`. Read `bb brandwise style packs`, then switch it on: `bb brandwise style enable <name>`.
3. `bb brandwise style show <name>/<id>` prints the style as an agent sees it. `bb brandwise creative cost --style <name>/<id> --slot <slot>="<text>"... --campaign <c>` renders it and prices the generation without spending anything; `creative generate` with the same arguments makes the creative.
4. Look at the result, read every word in the image, and try each aspect with `--aspect`.
5. After a change, raise the style's `version` and run `style add` again. That replaces the pack and switches it off again, so `style enable` follows.

`bb brandwise style disable <name>` switches the pack off, `bb brandwise style remove <name>` deletes it.

## Publishing

Put the pack at the top of a public git repository that is reachable over https. Whoever wants it runs:

```
bb brandwise style add https://github.com/<owner>/<repository>
```

That fetches the newest commit of the default branch, over https only and without signing in, reads the pack from it without checking anything out (no submodule, hook or large-file store comes with it), checks the pack and records the commit, so the person can read exactly what was stored before switching it on. To take a later version they run the same command again.
