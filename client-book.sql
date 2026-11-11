-- VOYAGE ONE — THE CLIENT BOOK (M1053, 11 Nov 2026)
-- Run once: Supabase → SQL Editor → New query → paste all of this → Run.
-- Safe to run again: nothing here deletes or changes an existing record.

-- 1. Who may open the Client Book. Add or remove a person by changing these lines and running again.
create table if not exists public.staff (
  email text primary key,
  name  text
);
insert into public.staff (email, name) values
  ('tholbrook@me.com', 'Tricia'),
  ('frannyjones91@gmail.com', 'Franny')
on conflict (email) do nothing;
alter table public.staff enable row level security;   -- no policies: only the server can read it

-- 2. Every TravelPro 365 booking, however it arrives (entered, imported, or read from a confirmation).
create table if not exists public.client_bookings (
  id            uuid primary key default gen_random_uuid(),
  created_at    timestamptz not null default now(),
  created_by    text,
  source        text not null default 'entered',     -- entered · travelpro-email · import
  client_first  text,
  client_last   text,
  client_email  text,
  client_phone  text,
  hotel         text,
  city          text,
  country       text,
  check_in      date,
  check_out     date,
  guests        int,
  room          text,
  rate          text,
  total         numeric,
  currency      text,
  confirmation  text,
  status        text default 'confirmed',             -- confirmed · cancelled · completed
  trip_ref      text,                                  -- the Voyage One journey it belongs to, when known
  notes         text,
  raw           text                                   -- the original confirmation text, when read from one
);
create index if not exists client_bookings_last on public.client_bookings (lower(client_last));
create index if not exists client_bookings_email on public.client_bookings (lower(client_email));
create index if not exists client_bookings_in on public.client_bookings (check_in);
alter table public.client_bookings enable row level security;   -- no policies: only the server can read it

-- 3. Your own notes about each client (one per client).
create table if not exists public.client_notes (
  client_key  text primary key,                       -- the client's e-mail, or their name
  note        text,
  updated_by  text,
  updated_at  timestamptz default now()
);
alter table public.client_notes enable row level security;   -- no policies: only the server can read it

-- 4. Reservation requests from the site (created here in case the earlier setup was never run).
create table if not exists public.reservations (
  id          uuid primary key default gen_random_uuid(),
  created_at  timestamptz not null default now(),
  user_id     uuid,
  session_id  text,
  hotel       text,
  city        text,
  check_in    date,
  check_out   date,
  guests      int,
  guest_first text,
  guest_last  text,
  email       text,
  phone       text,
  room        text,
  rate        text,
  notes       text,
  virtuoso    boolean,
  host        text,
  site        text,
  status      text
);
alter table public.reservations enable row level security;
do $$ begin
  if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'reservations' and cmd = 'INSERT') then
    create policy "anyone may send a request" on public.reservations for insert to anon, authenticated with check (true);
  end if;
end $$;
