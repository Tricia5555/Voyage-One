-- VOYAGE ONE — THE INVENTORY (M1067, 16 Nov 2026)
-- Run once: Supabase → SQL Editor → New query → paste all of this → Run.
-- Safe to run again: nothing here deletes or changes an existing record.
--
-- One row per restaurant (later: hotel, place). It holds what Voyage One is allowed to keep:
--   google_id  — Google's permanent ID for the place (Google's terms allow keeping this)
--   area, site, address, phone — Voyage One's OWN details for the place, gathered from the
--                restaurant itself. Never copied from Google.
-- With a row here, the site no longer pays Google to search for the restaurant by name.

create table if not exists public.place_ids (
  kind       text not null,                 -- restaurants · hotels · place
  city_key   text not null,                 -- the city, lower case, as the site asks for it
  name_key   text not null,                 -- the name, lower case, as the site asks for it
  city       text,
  name       text,
  google_id  text,
  area       text,                          -- neighbourhood, e.g. Tribeca
  site       text,                          -- the restaurant's own web address
  address    text,
  phone      text,
  updated_at timestamptz default now(),
  primary key (kind, city_key, name_key)
);
alter table public.place_ids enable row level security;   -- no policies: only the server can read or write it
