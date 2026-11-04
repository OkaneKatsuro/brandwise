# Analytics: measuring the whole campaign

Status 2026-11-04. Learnings and experiments already exist and work; what they lack is data. Today only e-mail reports numbers, so
everything the system learns comes from e-mail. The work below gives every channel a source of numbers, then lets tests and learnings
use any of them. It replaces the earlier `feat/analytics` branch, which built depth on e-mail only.

Scope: Western platforms only for now.

## Stack

Each step is one small pull request on top of the previous one.

| # | Branch | What it adds |
|---|---|---|
| 1 | `analytics/base` | Fixes the system needs whatever the source: power estimates (D2), review history (D4), UTM on every link (D6). |
| 2 | `analytics/metrics` | One port `MetricsSource` writing `metric_point` per calendar entry (`roadmap.md` §6). E-mail becomes one adapter; learnings and experiments read from it instead of `email_event`. |
| 3 | `sources/links` | Own short links with a redirect: clicks per entry in any channel, with nothing to set up on the client's side. |
| 4 | `sources/site` | GA4: visits and goals by `utm_content`, so leads arrive from the analytics the client already has, without webhooks or CSV. |
| 5 | `sources/ads-<platform>` | Ad platform reports, read only: spend, impressions, clicks, conversions per ad. |
| 6 | `sources/social-<platform>` | Organic post metrics. |
| 7 | `ads/buy`, `ads/acp` | Buying through the calendar and a person's approval, paid through a real ACP adapter. |

Not planned: LLM or token cost accounting (subscriptions make it meaningless).

## Defects fixed in step 1

| # | Defect | Fix |
|---|---|---|
| D2 | `minDetectableLift` gave both arms the control's variance and promised too much: +72 % instead of +85 % at a 2 % rate and 1,500 per arm. | `requiredPerArm` gives each arm its own variance; `minDetectableLift` solves it for the lift (`regulator/stats.ts`). |
| D4 | A send-back overwrote `review_note`; an approval stored neither who nor when. | `entry_event`: one row per action (created, edited, approved, changes_requested, unapproved, cancelled, published, failed, needs_manual) with actor, statuses, note, reason and data. `content_calendar.approved_at/approved_by`. `bb brandwise calendar history <id>`. |
| D6 | UTM only on `entry.link` of plain-text e-mails, with the entry id in `utm_campaign`; HTML, templates and Telegram untagged. | Every http(s) link in e-mail (text, HTML, templates) and Telegram posts gets `utm_source`, `utm_medium`, `utm_campaign=<campaign slug>` and `utm_content=<entry id>`; parameters already on a link are kept; merge tags, `mailto:` and the unsubscribe link are left alone. |

Notes on step 1:
- The actor is a label, not a verified identity: `ui` is a person on a page, `cli` or `cli:<label>` the command line (`--as <label>`), `auto` the tier-1 approval, `scheduler` publishing. The CLI refuses `--as ui`, `auto`, `scheduler` and `unknown`.
- Send-back reasons are a closed list: claims, facts, tone, brand, visual, legal, typo, offer, other. The approval dialog offers them; the CLI takes `--reason`.
- `utm_campaign` changed from the entry id to the campaign's slug. Reports that grouped by `utm_campaign` to find an entry must use `utm_content`.
