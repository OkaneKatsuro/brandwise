# The company map

The Map page shows where everything of one company came from and where it went: the sites its pack was read from, the pack, its
campaigns, their creatives, the posts and what the posts brought. It is a view. Code places the cards; nothing is dragged, connected
or run from it, and every change is still made through the CLI, the Calendar and the Creatives page (plan:
`context-styles-map.md`, steps 9 and 10).

A company is an always-on base with every campaign under it. The page takes any campaign of a company in its route
(`map/<campaign id>`) and shows that company.

## Columns

Left to right, the newest on top. Every node has an id that stays the same from one read to the next (`post:<entry id>`), its
column and its place in the column; pixels are the page's business.

| Column | One node per | It says | Read from |
|---|---|---|---|
| `source` | site read for the pack | the site, its latest read, how many pages that read took. The page the look was taken from (`research look`) and the profiles read (`research social`) are not nodes: `bb brandwise product list` names them | `context_source` |
| `pack` | company (always one) | the current version of each file and whether a person confirmed it, the look's `design.md` and `design.json` among them once they are written; which of the five files are missing (the look's two are never missing) | `context_doc` |
| `campaign` | the company and each campaign under it | name, kind, and how many of its creatives and posts the map leaves out | `campaign` |
| `creative` | asset with the role `creative` | name, kind, the style it was generated from and the prompt, when its provenance has them | `asset` |
| `post` | calendar entry, whatever its status | title, channel, status, time | `content_calendar` |
| `result` | published post whose views or clicks some source measured | views, clicks, the virality verdict and the ratio it was taken from | the metrics service (`analytics.md`) |

A number no source measured is unknown, never zero. The verdict is the one `bb brandwise metrics virality` gives: the post against
its own company's earlier posts on the same channel.

## Edges

An edge is drawn only where the data records the link, from what a thing came from to the thing.

| Edge | The link in the data |
|---|---|
| `source -> pack` | the site was read for this company's pack (`context_source.campaign_id`) |
| `pack -> campaign` (the company) | the pack is the company's (`context_doc.campaign_id`); an empty pack feeds nothing |
| `campaign -> campaign` | `campaign.parent_id` |
| `campaign -> creative` | the asset's campaign |
| `creative -> creative` | `asset_link` with the relation `derived_from`, from the original to what was derived from it |
| `creative -> post` | the entry's asset |
| `campaign -> post` | an entry with no creative on the map: it has no asset, or its asset is not a creative of the company |
| `post -> result` | the numbers are the entry's |

A link to something the map does not show is left out, so every edge joins two nodes.

## Bounds

The map of a company with years of posts is as large as that of a new one. Shown are:

- the newest 40 posts, by their time in the calendar;
- the creatives those posts use;
- the newest 20 creatives that no post of the company uses.

What is left out is counted per campaign, so the page can say "and 37 older posts".

## Chain and details

A click selects a card. Its chain lights up and the rest is dimmed: every node it came from, back to the sites, and every node that
came from it, however many steps away (`chain` in `packages/core/src/map/domain.ts`). The page's sidebar, where the other pages keep their lists, shows the card's details
with a way to where the thing lives, so the board has the page's whole width: a creative's picture, style and prompt; a post's text, status, channel and the pack it was written from;
the pack's files; a result's numbers and what its verdict means.

The pack a post was written from is the pack as it stood when the entry was created: of each file the newest version written by
then, and a draft where a person confirmed it only later (`core.context.asOf`). Rows of `context_doc` are only added, so the past is
read by time and no link to a version is kept.

## Where it lives

- `packages/core/src/map/`: `domain.ts` (pure: nodes, edges, order, chain) and `index.ts` (the bounded reads), wired into the core as
  `core.map`. `company(campaignId, metrics, asOf)` returns the map; `post(entryId)` returns a post's text and pack. The metrics
  service is built by the shell, with the sources it holds the keys of, so `company` is handed it.
- `apps/bb-plugin-brandwise/map.ts`: the RPC contract (`map_company`, `map_post`).
- `apps/bb-plugin-brandwise/map-page.tsx`: the page, drawn with `@xyflow/react`.

The page reads the map again when the calendar, the assets or the campaigns change (the plugin's realtime topics). A change of the
pack alone has no topic yet, so it shows with the next of those changes or when the page is opened again. "Start agent" in the side
panel opens one thread per company that knows which company the user looks at.
