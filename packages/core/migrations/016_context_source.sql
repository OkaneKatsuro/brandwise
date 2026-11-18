-- Where a company's context came from (docs/context-styles-map.md, step 2): one row per source read for the pack, each time it is
-- read. A site gives one row per page, and the page's text is the asset. Rows are only added. They belong to the owner of the
-- pack, the always-on base at the root, as the rows of context_doc do, and go with it.
create table context_source (
  id          bigserial primary key,
  campaign_id uuid not null references campaign(id) on delete cascade,
  kind        text not null,                                 -- site; the kinds are named in code, so a later one needs no migration
  ref         text not null,                                 -- what was read: for a site, the address of the page
  asset_id    uuid references asset(id) on delete set null,  -- what it said; null once that asset was deleted: that it was read stays on record
  fetched_at  timestamptz not null,                          -- when; the pages of one read of a site share it, which is what makes them one read
  note        text                                           -- what the reader had to say about it (a page with almost no text); null when nothing
);
create index context_source_campaign_idx on context_source (campaign_id, kind, fetched_at);
