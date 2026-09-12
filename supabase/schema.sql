-- Professional Events Tracker: database setup
-- Run once in Supabase: Dashboard -> SQL Editor -> New query -> paste -> Run.
-- Safe to re-run.

-- Who counts as a cohort member: any signed-in account whose email is @berkeley.edu
-- (or a subdomain such as @haas.berkeley.edu).
create or replace function public.is_berkeley()
returns boolean
language sql
stable
as $$
  select coalesce(lower(auth.jwt() ->> 'email'), '') ~ '@([a-z0-9-]+\.)*berkeley\.edu$'
$$;

-- Events: written only by the daily refresh (secret key bypasses RLS), read by cohort members.
create table if not exists public.events (
  id            text primary key,          -- stable slug, e.g. 2026-09-17-ewmba-cohort-mixer
  title         text not null,
  starts_at     timestamptz not null,
  ends_at       timestamptz,
  all_day       boolean not null default false,
  location      text,
  region        text,                      -- berkeley | east-bay | sf | peninsula | south-bay | north-bay | online
  format        text,                      -- in-person | virtual | hybrid
  description   text,
  url           text,
  source        text not null,             -- bear-necessities | newsletter | campus-groups | slack | bay-area
  source_detail text,                      -- e.g. "EWMBA Weekly, Sep 8" or "#ewmba-2027"
  category      text,                      -- see docs/app.js CATEGORIES
  audience      text,                      -- ewmba | haas | berkeley | public
  cost          text,                      -- "Free", "$25", "Free for students"
  rsvp_required boolean not null default false,
  rsvp_deadline timestamptz,
  tags          text[] not null default '{}',
  updated_at    timestamptz not null default now()
);
create index if not exists events_starts_at_idx on public.events (starts_at);

alter table public.events enable row level security;
drop policy if exists "Cohort reads events" on public.events;
create policy "Cohort reads events" on public.events
  for select to authenticated using (public.is_berkeley());

-- RSVPs: "I'm going" marks. Everyone in the cohort can see them; you can only change your own.
create table if not exists public.rsvps (
  event_id     text not null references public.events (id) on delete cascade,
  user_id      uuid not null default auth.uid() references auth.users (id) on delete cascade,
  display_name text not null,
  created_at   timestamptz not null default now(),
  primary key (event_id, user_id)
);
create index if not exists rsvps_event_idx on public.rsvps (event_id);

alter table public.rsvps enable row level security;
drop policy if exists "Cohort reads rsvps" on public.rsvps;
drop policy if exists "Add own rsvp" on public.rsvps;
drop policy if exists "Edit own rsvp" on public.rsvps;
drop policy if exists "Remove own rsvp" on public.rsvps;
create policy "Cohort reads rsvps" on public.rsvps
  for select to authenticated using (public.is_berkeley());
create policy "Add own rsvp" on public.rsvps
  for insert to authenticated with check (public.is_berkeley() and user_id = auth.uid());
create policy "Edit own rsvp" on public.rsvps
  for update to authenticated using (user_id = auth.uid()) with check (user_id = auth.uid());
create policy "Remove own rsvp" on public.rsvps
  for delete to authenticated using (user_id = auth.uid());

-- One-row status table the page reads for its "Updated ..." stamp.
create table if not exists public.feed_meta (
  id           int primary key default 1 check (id = 1),
  refreshed_at timestamptz,
  summary      text,
  counts       jsonb
);
alter table public.feed_meta enable row level security;
drop policy if exists "Cohort reads feed meta" on public.feed_meta;
create policy "Cohort reads feed meta" on public.feed_meta
  for select to authenticated using (public.is_berkeley());

grant select on public.events, public.feed_meta to authenticated;
grant select, insert, update, delete on public.rsvps to authenticated;

-- Live updates so "who's going" changes appear without a reload.
do $$
begin
  begin alter publication supabase_realtime add table public.rsvps;  exception when duplicate_object then null; end;
  begin alter publication supabase_realtime add table public.events; exception when duplicate_object then null; end;
end $$;
