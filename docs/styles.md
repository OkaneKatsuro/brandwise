# Styles and style packs

A style is a recipe for one kind of creative: a prompt template written once, with a few slots that whoever generates fills in. Code
renders the template, sets the model and the aspect, and records the style in the asset, so results can later be compared by the
style that made them. A style is shared by every company and never copied per company: what makes a creative the company's own is
what goes into the slots, and the company's look, which code puts in front of every prompt (plan: `context-styles-map.md`, steps 5
and 6).

## A style

One object. `parseStyle` in `packages/core/src/styles/domain.ts` is the only validator of its shape: whatever passes can be listed,
shown and rendered.

| Field | What it holds |
|---|---|
| `id`, `title` | The name it is used by, and a short name for people |
| `kind` | `image` or `video` |
| `aspects` | The aspect ratios the composition holds in; the first is the default |
| `channels` | The calendar channels the format suits |
| `slots` | What the caller fills in: slot name to what the slot should hold. Every slot is required |
| `prompt` | A Mustache template that may only insert the slots, and must insert each |
| `models`, `params` | Optional: the model per provider, and parameters of the model |
| `version` | Raised with every change of the recipe: results are compared by style and version |
| `use`, `copy`, `avoid` | For whoever chooses: when the style fits, the pattern of the post text that goes with it, what to avoid |

Every text is on one line and holds no control character, so a list or a terminal shows it as it was written.

There are two kinds of styles, told apart by their address:

- **Built-in** styles are TypeScript modules in `packages/core/src/styles/builtin/`, with a bare id such as `product-hero`. A test
  pins each recipe to its version, so a recipe cannot change without a new one.
- Styles of a **pack** come from outside the repository and are addressed as `<pack>/<id>`, such as
  `founder-extras/comparison-table`. A pack can therefore never replace a built-in style or another pack's.

`bb brandwise style list [--kind image|video] [--channel <c>]` lists the styles that can be used now, `style show <id>` prints one in
full, and `creative generate --style <id> --slot <name>="<text>"...` generates from it (`creative cost` prices the same call and
spends nothing). The asset's provenance records `style: { id, version, origin }`, where `origin` is `built-in` or `pack:<name>`;
`metrics styles` reads it. How an agent chooses a style and fills its slots is the skill `creative-styles`.

## A style pack

A pack is a folder, or a git repository, with a `pack.json` (name, author, licence) and one `styles/<id>/style.json` per style.
`examples/style-pack/` is a complete one, and its [`README.md`](../examples/style-pack/README.md) is the reference for authors:
every field with its limits, how to write a good style, how to test and publish a pack.

A pack is somebody else's text that becomes prompts on this machine. Three rules follow from that, and each is the core's, so the
CLI and the page cannot differ in them.

### It is checked whole

`style add <full path of a folder | https git address>` reads the pack and checks it before anything is stored
(`checkPack` in `packages/core/src/styles/pack.ts`). A pack holds `pack.json`, a `README.md` and a `LICENSE` if it has them, and its
`style.json` files; nothing else. Any other file or folder, a symbolic link, a file over 100,000 bytes, more than 100 styles, a
`pack.json` or a `style.json` that does not validate, or a style folder that is not named after its style refuses the whole pack. The
refusal lists every problem at once, and nothing of the pack is stored.

A git repository is fetched over `https` only, without signing in, from a public address that was checked and is the one connected
to, and as a bare clone: nothing is checked out, so no hook, filter, submodule or large-file store of the repository is used, and
this machine's git configuration is left out (`packages/core/src/styles/source.ts`).

### It is stored in Postgres, and it arrives off

Nothing of a pack is kept on disk. `style_pack` holds one row per pack (source, the commit of a git source, author, licence, who
added it and when, who switched it on and when) and `style_pack_style` its styles as they were written, so every machine on the
same database has the same packs. Adding a pack of a name that is already there replaces it, styles and all.

A pack is off after every `style add`, also when it replaces one that was on: its text changed, and no person has read the new one.
The styles of a pack that is off are not listed and cannot be shown or used.

### A person reads it, then switches on exactly what was read

`style review <pack>` shows what is stored: where the pack came from, every style in full, and the **digest** of that text, a SHA-256
over the pack's name, author, licence and styles. `style enable <pack> --digest <digest>` switches on the text with that digest and
no other: when the pack was added again between the reading and the switch, the digest is another one, the core refuses, and the
pack stays off until the new text is read. Only the whole digest counts.

`style disable <pack>` switches a pack off again; assets made in its styles keep their record. `style remove <pack>` deletes it.

Adding, reviewing, switching on and removing are a person's decisions. The actor is recorded with the pack (`cli`, `cli:<label>`,
or `ui` for the Styles page); it is a label, not a verified identity, so that agents never do any of the four is a rule of their
skills and briefs.

## The Styles page

The page shows the same library and makes the same decisions, with the same core calls.

- **Styles.** The styles that can be used now, built-in first, then those of the packs that are on, as cards: title, id, kind,
  aspects, channels and when to use it. The filters for kind and channel are the ones of `style list`. A click opens a style in
  full, as `style show` has it: its slots, the post text, what to avoid, the model per provider, parameters, version, where it
  comes from, the template, and the command that generates from it, with a copy button.
- **Packs**, in the page's sidebar: every pack with its author, licence, source and commit, who added it and when, and whether it
  is on, since when and by whom. A pack that is on is switched off there; any pack is removed there, after a second click.
- **Adding.** One field takes the https address of a git repository or the full path of a folder on the machine BrandWise runs
  on. A refused pack shows the list of problems the check found; an accepted one arrives off and opens for reading.
- **Review.** A pack opens as what `style review` prints: every stored style in full, marked as not yet usable while the pack is
  off, with the digest of that text. "Switch on this text" stands at the end and sends the digest of the text on the screen.
  That text stays on the screen until the person asks for another: when the pack is added again meanwhile, the page says so and
  offers the new text, and it never puts other text above the same button. A switch the core refuses shows the refusal and the
  new text, to be read before another try.

Author, licence and every text of a style are a stranger's words. The page renders them as plain text, author and licence in
quotation marks as the CLI prints them, and never as HTML or Markdown.

The plugin publishes the realtime topic `styles-changed` after every write to the packs, from the page or the CLI, and the page
follows it: the cards, the sidebar and an open review. "Start agent" in the side panel opens a thread that helps choose a style and
proposes a new one when none fits; it never adds, reviews, switches or removes a pack.

## Where it lives

- `packages/core/src/styles/`: `domain.ts` (pure: the shape of a style, its rendering, addresses), `pack.ts` (pure: where a pack
  may come from and what it may hold), `source.ts` (reading a folder, fetching a repository), `index.ts` (the library and the
  packs on Postgres), wired into the core as `core.styles`; `builtin/` holds the built-in styles.
- `apps/bb-plugin-brandwise/style-cli.ts`: the `bb brandwise style` commands.
- `apps/bb-plugin-brandwise/styles.ts`: the RPC contract of the page (`styles_list`, `styles_packs`, `styles_review`, `styles_add`,
  `styles_enable`, `styles_disable`, `styles_remove`).
- `apps/bb-plugin-brandwise/styles-page.tsx`: the page and its sidebar.
