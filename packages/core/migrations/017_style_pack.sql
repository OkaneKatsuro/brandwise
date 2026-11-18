-- Style packs (docs/context-styles-map.md, step 6): styles that come from outside the repository, the same on every machine.
-- A pack is stored whole after it passed the check and nothing of it stays on disk. Its text becomes prompts, so a pack is off
-- (enabled_at null) until a person has read it and switched it on; adding it again replaces its styles and switches it off again.
create table style_pack (
  name         text primary key,              -- from pack.json; the first part of a style's address, <pack>/<id>
  source       text not null,                 -- the folder or the https git address it was added from
  revision     text,                          -- the commit of a git source; null for a folder
  author       text not null,
  licence      text not null,
  installed_at timestamptz not null default now(),
  installed_by text not null,                 -- cli, cli:<label>: the actor labels of entry_event, not a verified identity
  enabled_at   timestamptz,
  enabled_by   text,
  check ((enabled_at is null) = (enabled_by is null))
);

-- One style of a pack, as parseStyle accepted it. Rows go with their pack.
create table style_pack_style (
  pack text not null references style_pack(name) on delete cascade,
  id   text not null,                         -- the style's own id; the pack's styles/<id>/ folder
  body jsonb not null,
  primary key (pack, id)
);
