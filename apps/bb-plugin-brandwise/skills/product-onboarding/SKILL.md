---
name: product-onboarding
description: Interview the user about a product or brand and write its BrandWise product pack (product, audience, claims, constraints, voice). Use when a campaign has no product pack, when the user asks to set up, onboard or describe a product, or to refresh the pack.
---

# Product onboarding

Goal: the user answers once, the pack lets any agent write on-brand content later. The pack belongs to the always-on base campaign and is kept in the database, the same for every thread and machine. Read and write it only with `bb brandwise product list|get|set`.

**Versions and confirmation.** Every `product set` adds a version of that file under your label (pass `--as <your role>`) and makes the file a draft. `product list` shows each file's version, who wrote it and whether it is confirmed or a draft; `product history <file>` shows every version of a file, who wrote it and when. A person confirms the pack with `bb brandwise product confirm [<file>]`. You never run `product confirm`: it is the person's own statement that they read the file and that it is right.

1. Pick the campaign (ask if unclear) and run `product list`. If files exist, show what is there and ask which to redo; never overwrite without saying so. If the brand had a pack before packs were kept in the database and the list is empty, `bb brandwise product import` brings it in from this machine's disk (safe to repeat, it never replaces a file the database has).
2. Interview with the ask-user-question tool, one topic per question screen, 2-4 options plus free text where an answer is open. Topics, in order:
   - **product**: what is sold, the one-sentence promise, price range, how it is bought.
   - **audience**: who buys, who decides, their problem in their words, markets and languages.
   - **claims**: numbers, guarantees, awards, subsidies, comparisons the brand may state, each with its source and until when it holds.
   - **constraints**: topics and words never to use, legal or regulated areas, competitors not to name, required disclaimers.
   - **voice**: tone (3 adjectives), formal or informal address, examples of text they like and dislike.
3. Do not invent answers. If the user is unsure, write `TODO: <what is missing>` in that spot.
4. Write each file with `product set <file> --file <path>` (write the text to a temp file first), in this shape:
   - `claims.md`: one claim per line: `- claim | source | valid until (YYYY-MM-DD or "open") | markets`. A later claims check compares text against these lines, so keep the format exactly.
   - other files: short headings and bullet points, no prose over ~10 lines per section.
5. Show the user a summary of what was saved and list the `TODO` items. Ask them to read the files and, when they are right, to confirm them with `bb brandwise product confirm`. Do not write `derived/` files yet; positioning and keywords are a separate step the user approves.
