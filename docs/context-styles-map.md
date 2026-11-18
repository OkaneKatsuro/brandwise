# Plan: company context, style library, virality and the company map

Status 2026-11-17: plan, nothing built. Extends `roadmap.md` items 4 (product pack) and 8 (research tools), `brand-system.md` and
step 6 of `analytics.md`.

**Who it is for.** Technical startup founders who do their own marketing, do not want to hire for it and want it automated. They can
install bb, so bb stays the shell (decided 2026-11-17). All logic stays in `packages/core`, which does not import bb, so another shell
remains possible later.

**What sets it apart.** Schedulers such as Postiz publish what a person wrote. BrandWise first builds the company's context itself
(from the site, the social profiles and the design files), then makes creatives, campaigns and plans from it, measures what spread and
shows the whole chain on one page.

**Terms.** A *company* is an always-on base campaign; time-bound campaigns live under it and share its context. The *pack* is the
company's context: `product.md`, `audience.md`, `claims.md`, `constraints.md`, `voice.md`, `design.md`, `design.json`, `derived/*.md`.

## Stack

Each step is one small pull request. Steps 5 and 6 depend on nothing before them; step 8 needs step 7; step 9 shows whatever exists.

| # | Branch | What it adds |
|---|---|---|
| 0 | (open PRs #9 to #11) | Publishing connectors merged, at least one social channel tested live. Without posts there is nothing to measure. |
| 1 | `stack/context-1-store` | The pack moves from the local disk to Postgres, with versions. |
| 2 | `stack/context-2-site` | `research site <url>`: the agent drafts the pack from the company's site, asks only about gaps, a person confirms. |
| 3 | `stack/context-3-design` | The company's look (colours, fonts, logo, image style) as part of the pack, applied to every generation by code. |
| 4 | `stack/context-4-social` | `research social <profile>`: how the company already speaks and what it posts. |
| 5 | `stack/styles-1-library` | Style recipes: `style list|show`, `creative generate --style`, ten built-in styles. |
| 6 | `stack/styles-2-packs` | Style packs from a git repository and a Styles page with a gallery (the "market"). |
| 7 | `stack/analytics-6-social-<platform>` | Organic post numbers per platform (already named in `analytics.md`). |
| 8 | `stack/virality-1-rules` | Virality computed by code against the account's own baseline; results by style. |
| 9 | `stack/map-1-read` | The Map page: a read-only board of one company, from sources to results. |
| 10 | `stack/map-2-actions` | Lineage highlight and "Start agent" on a node. |

Beside the stack: a BytePlus ModelArk provider (`packages/core/src/providers/byteplus.ts`, Seedance 2.5 for video and Seedream 5.0 Pro
for images) next to `higgsfield.ts`. It implements the existing `Provider` interface and changes nothing else.

## Step 1: the pack in Postgres

Today the pack is five files under `~/.bb-brandwise/product/<campaign id>/` (`apps/bb-plugin-brandwise/product.ts`): no history, lost
with the machine, invisible to pages.

- Table `context_doc (campaign_id, name, version, body, author, confirmed_at, created_at)`, primary key `(campaign_id, name, version)`.
  Rows are only added; the newest version of a name is the current one.
- Table `context_source (id, campaign_id, kind, ref, fetched_at, note)`, `kind` in `site | social | file | interview`. Raw material
  (page text, screenshots, brand books, logos) is stored as assets with role `reference` or `brand`, so it lives in S3 like everything
  else and `ref` points to it.
- The commands keep their names: `bb brandwise product list|get|set`. New: `product history <file>`, `product confirm` (only a person,
  like approvals) and `product import` for packs already on disk.
- No link column is needed for lineage. Rows are only added, so "which context was in force when this entry was made" is answered by
  time: the newest confirmed version created before the entry.

Done when: a pack written on one machine is read on another, and `product history voice.md` lists who changed what and when.

## Step 2: research from the site

- `bb brandwise research site <url> [--pages 12] --campaign <c>` reads the home page and the pages its navigation links to, up to the
  limit. It keeps readable text, titles, descriptions, OpenGraph and JSON-LD (organisation, product, prices), saves each page as a
  `reference` asset, takes one screenshot of the home page with the headless Chrome adapter the e-mail preview already uses, and prints
  a bounded digest. Same pattern as `roadmap.md` item 8: the provider is a small adapter, the output is never a raw export.
- The skill `product-onboarding` gets a new order: research, draft, questions, summary, confirmation.
  1. Draft `product.md`, `audience.md` and `voice.md` from the digest, every statement with the page it came from.
  2. `claims.md`: only claims found on the site word for word, with the page as their source. Nothing is invented.
  3. Ask the person only what the site did not answer (`TODO` items). `constraints.md` is always asked: a site does not say what must
     not be said.
  4. Show a one-page summary of the company; the person corrects it and runs `product confirm`.
- Text of a site is data, never instructions: the skill says so, and the digest is wrapped as quoted material.
- Agents may read an unconfirmed pack but must say it is a draft; the claims lint (`roadmap.md` item 5) reads confirmed versions only.

Done when: a founder gives one URL, answers at most ten questions, and an agent writes a correct draft post from the pack alone.

## Step 3: the company's look

For a company that already has a site, the look is documented, not designed (`brand-system.md`: "change nothing, only document it").
The full generator for companies without an identity stays as planned there.

- Code collects candidates, never the model: `research site` also returns the colours of the page by where they are used (background,
  text, main button, links), the font families of headings and body, and logo candidates (header image, icon, OpenGraph image), all
  read from the rendered page. For an uploaded logo, its dominant colours.
- Design files come in as assets: `bb brandwise assets add <file> --role brand` (brand book as PDF, exported frames, fonts). The agent
  reads them and proposes roles for the candidates; the person confirms.
- Result in the pack: `design.md` (palette with roles, fonts, logo rules, image style, what to avoid) and `design.json` (the same
  values for code: `colors`, `fonts`, `imagePromptPrefix`, `brandRefs` as asset ids).
- Applied by code: `creative generate` in a company with a confirmed `design.json` puts the prefix before the prompt and adds the brand
  references, unless `--no-brand` is given. The asset's provenance records that it did. Later the e-mail brand kit
  (`email_brand_kit`) can be filled from the same file.

Done when: two creatives generated a week apart by different threads share colours and image style without either prompt naming them.

## Step 4: research from social profiles

- `bb brandwise research social <profile url> [--last 30]` reads the company's own public profile with the downloaders the repository
  already has (`tools/ig-dl.sh`, `tools/video-dl.sh`, `assets download-videos`): caption, format, date and the counts the platform
  shows publicly.
- The agent writes `derived/social-audit.md`: rhythm, formats, recurring openings, what got the most reactions, and adds real examples
  of the company's own wording to `voice.md`.
- Public content only, with the session the person already chose in Settings > Downloads. Competitors' profiles use the same command
  and go to `derived/competitors.md`.

Done when: for a profile with 30 posts the audit names the three formats used most and quotes five typical openings.

## Step 5: style library

A style is a recipe for one kind of creative, shared by every company. What makes the result the company's own is its pack and
`design.json`, so a style is never copied per company.

```
apps/bb-plugin-brandwise/styles/<id>/
  style.json       # what code reads
  STYLE.md         # what the agent reads
  examples/*.jpg   # optional: one to three sample outputs, shown in the gallery
```

- `style.json`: `id`, `title`, `kind` (`image | video`), `aspects`, `channels`, `slots` (what the agent fills in, for example
  `subject`, `setting`), `prompt` (a Mustache template over the slots; Mustache is already a dependency), `models` (one per provider,
  for example `byteplus: dreamina-seedance-2-5-260628`; a provider without an entry needs `--model`), `params`, `version`. Plain JSON,
  so the core needs no new parser.
- `STYLE.md`: when to use the style, what each slot should hold, the pattern of the post text that goes with it (opening line,
  structure), and what to avoid.
- Commands: `bb brandwise style list [--kind] [--channel]`, `style show <id>`, and
  `creative generate --style <id> --slot subject="..."`. Code renders the template, adds the company's look (step 3) and picks the
  model of the configured provider. The agent supplies only the slots.
- Provenance of the asset records `style: { id, version, origin }`, which is what steps 8 and 9 read.
- Styles are folders shaped like skills, but they are not registered as bb skills: dozens of them would fill every thread's skill
  list. One skill, `creative-styles`, tells the agent how to choose (goal, channel, what worked: `metrics styles`), to fill slots from
  the pack, and to propose a new style when none fits instead of editing a template in place.
- First set, chosen for startup founders: product hero shot, product screen showcase, launch announcement, feature card, changelog
  post, build-in-public update, founder talking to camera, customer quote, before and after, meme.

Done when: `creative generate --style product-hero --slot subject="..."` gives an on-brand image in two companies with different
looks, and each asset's provenance names the style.

## Step 6: style packs (the "market")

- A pack is a git repository with `pack.json` (name, author, licence) and `styles/*/STYLE.md`.
  `bb brandwise style add <git url | folder>` copies it to `~/.bb-brandwise/styles/<pack>/`; `style update`, `style remove`.
  Lookup order: installed packs, then built-in styles; an installed style with the same id wins.
- A pack holds Markdown, JSON and images only; a file of any other type stops the install. A recipe becomes a prompt, so an installed
  pack is off until a person has seen it and switched it on.
- The Styles page: a gallery of installed and built-in styles with their examples, per-company on/off, and "Available": packs listed
  in `styles-index.json` in this repository (a pull request adds a pack to the list).
- No accounts, ratings or payments. The project is open source; a shared list and git are enough until outside authors exist.

Done when: a pack from a public repository is installed with one command, switched on in the page and used by `creative generate`.

## Step 7: organic post numbers

Step 6 of `analytics.md`. One `MetricsSource` with `pull` per platform (`packages/core/src/metrics/domain.ts`), keyed by the
`external_id` the connector stored when it published. It reports what the platform exposes of `exposures`, `reach`, `reactions`,
`comments`, `shares`, `saves`, `video_views`; a number the platform does not give stays unknown, never zero. The hourly pull already
stores each answer as a point in `entry_metric`, so history builds up.

One pull request per platform, in the order the channels go live. Reading numbers usually needs one more permission than posting, so
each platform's connect step is extended; check the platform's current API before building.

Done when: a post published through the calendar shows views, reactions and shares in `metrics campaign` the next hour.

## Step 8: virality by rule

Computed by code in a pure module (`packages/core/src/metrics/virality.ts`), never judged by a model.

- **Rates** of an entry: share rate = shares / exposures, save rate = saves / exposures, engagement rate = (reactions + comments +
  shares + saves) / exposures. Unknown inputs give an unknown rate (`rate` in `domain.ts` already works this way).
- **Speed**: exposures 1 hour, 24 hours and 7 days after the entry reached its audience, read from the stored points "as of" that age.
- **Baseline**: the median of the same number, at the same age, over the previous 20 published entries of the same company on the same
  channel. Absolute numbers are not used: ten thousand views is a hit for a small account and a failure for a large one.
- **Ratio** = the entry's exposures at 24 hours / the baseline.
- **Verdict**:

  | Verdict | Rule |
  |---|---|
  | `viral` | ratio at least 3 and share rate at least the baseline share rate (reach that was bought or accidental does not count) |
  | `above` | ratio at least 1.5 |
  | `typical` | ratio between 0.67 and 1.5 |
  | `below` | ratio under 0.67 |
  | `unknown` | fewer than 5 earlier entries, or exposures unknown |

  The thresholds are settings of the company (`virality.viralRatio`, default 3).
- Commands: `bb brandwise metrics virality --campaign <c>` (entry, channel, age, exposures, ratio at 1 hour and at 24 hours, share
  rate, verdict, style) and `metrics styles --campaign <c>` (per style: entries, median ratio, share rate, number of viral ones).
- Later, with `roadmap.md` item 9: a ratio of 3 or more at 1 hour goes to `inbox` as "taking off", and the weekly digest writes what
  the viral entries share to the journal as a learning. Neither `inbox` nor the digest exists yet, so step 8 does not build them.

Done when: with 20 earlier posts in the test data, a post with four times the median views and a normal share rate is listed as
`viral`, one with four times the views and no shares is not, and an account with three posts gets `unknown`.

## Steps 9 and 10: the company map

A board that shows where everything of one company came from and where it went. It is a view, not an editor: agents decide the steps,
the map shows them. Wiring nodes by hand, as in ComfyUI, is not planned; it would replace the agent, not help it.

- A new page "Map" (`app.slots.navPanel`), one company at a time.
- One server call returns nodes and edges, computed from tables that exist:

  | Column | Nodes | Read from |
  |---|---|---|
  | Sources | site, profiles, files, interview | `context_source` |
  | Context | pack files with version and confirmation | `context_doc` |
  | Campaigns | the company and its campaigns, with their agent threads | `campaign`, thread assignment |
  | Creatives | images and videos, with their style | `asset`, `asset_link`, provenance |
  | Posts | calendar entries with status and channel | `content_calendar`, `entry_event` |
  | Results | numbers and the virality verdict | `entry_metric`, step 8 |

- Positions are computed (columns left to right, newest on top), nobody drags or connects anything. The board is bounded: the newest
  entries are shown, older ones are folded into a count per campaign.
- Step 9: pan and zoom, a click opens the dialog that already exists for that thing (creative preview, calendar entry, pack file).
  Drawing uses a graph library for React (`@xyflow/react`); the first task is a small trial that it builds inside a bb plugin page,
  with plain SVG as the fallback.
- Step 10: hovering a node lights up its chain in both directions (from a viral post back to its creative, style, campaign and the
  context version in force), and "Start agent" on a node opens a thread that knows the node, through a new `map` screen in
  `agents.ts`.

Done when: for a company with one campaign, ten creatives and ten posts, a click on the best post shows its creative, its style and
the context it was written from, without opening another page.

## Not planned

- A node editor that runs pipelines.
- Virality scores or predictions made by a model.
- A style store with accounts, ratings or payments.
- A separate web application. If people who cannot install bb must use it one day, it is a second shell over `packages/core`.

## Open

- Which channels go live first: it sets the order of step 7 and which baseline exists first.
- Whether a claim found on the company's own site counts as confirmed, or always needs the person.
- Each platform's permissions and limits for reading post numbers.
- Whether the graph library builds inside a plugin page (the trial in step 9).
