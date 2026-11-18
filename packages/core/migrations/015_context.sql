-- The company's context, the "pack" (docs/context-styles-map.md, step 1): the Markdown files of an always-on base, kept as versions
-- so that it is known who changed what and when, and so that every machine reads the same pack. A row is one version of one file.
-- Rows are only added and their text never changes: the newest version of a name is the current one. The one later change to a
-- row is its confirmation by a person (who and when); a version without one is a draft. Rows go with their campaign.
create table context_doc (
  campaign_id  uuid not null references campaign(id) on delete cascade,
  name         text not null,                 -- product.md, audience.md, claims.md, constraints.md, voice.md, derived/<name>.md
  version      int not null check (version >= 1),
  body         text not null,
  author       text not null,                 -- cli, cli:<label>: the actor labels of entry_event, not a verified identity
  confirmed_at timestamptz,
  confirmed_by text,
  created_at   timestamptz not null default now(),
  primary key (campaign_id, name, version),
  check ((confirmed_at is null) = (confirmed_by is null))
);
