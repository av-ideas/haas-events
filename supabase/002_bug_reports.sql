-- Professional Events Tracker: bug reports
-- Run once in Supabase: SQL Editor -> New query -> paste -> Run. Safe to re-run.
-- Requires schema.sql (uses public.is_berkeley()).

create table if not exists public.bug_reports (
  id          bigint generated always as identity primary key,
  created_at  timestamptz not null default now(),
  user_id     uuid references auth.users (id) on delete set null,
  email       text,
  kind        text not null check (kind in ('bug', 'event', 'idea')),
  message     text not null check (char_length(message) between 5 and 2000),
  event_id    text,
  page_url    text check (char_length(page_url) <= 500),
  user_agent  text check (char_length(user_agent) <= 500),
  viewport    text check (char_length(viewport) <= 40),
  app_state   jsonb check (pg_column_size(app_state) <= 16000),
  status      text not null default 'new' check (status in ('new', 'seen', 'fixed', 'wontfix'))
);
create index if not exists bug_reports_status_idx on public.bug_reports (status, created_at);

-- Cohort members can file reports but can't read anyone's (including their own).
-- You read them in Table Editor, and the daily refresh summarizes new ones in its log.
alter table public.bug_reports enable row level security;
drop policy if exists "Cohort files reports" on public.bug_reports;
create policy "Cohort files reports" on public.bug_reports
  for insert to authenticated with check (public.is_berkeley());
grant insert on public.bug_reports to authenticated;

-- Fill identity fields server-side (so they can't be faked) and cap each person at 5 reports per hour.
create or replace function public.bug_reports_guard()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  new.user_id    := auth.uid();
  new.email      := auth.jwt() ->> 'email';
  new.status     := 'new';
  new.created_at := now();
  if (select count(*) from public.bug_reports
      where user_id = new.user_id and created_at > now() - interval '1 hour') >= 5 then
    raise exception 'You''ve sent 5 reports in the last hour. Try again later.' using errcode = 'P0001';
  end if;
  return new;
end
$$;

drop trigger if exists bug_reports_guard on public.bug_reports;
create trigger bug_reports_guard
  before insert on public.bug_reports
  for each row execute function public.bug_reports_guard();
