-- Keep-alive heartbeat
-- Run this once in the Supabase SQL editor (Project > SQL Editor > New query).
-- It's separate from schema.sql because schema.sql isn't safe to re-run
-- (its `create policy` lines fail the second time).
--
-- Why: a read-only REST request that RLS filters down to `[]` may not count
-- as activity, and the project paused anyway. This gives the GitHub Action
-- a real write to make: one row whose timestamp gets bumped on every ping.

-- A single-row table. The check constraint stops it from ever holding more
-- than one row, so the pings can't make it grow.
create table if not exists keepalive (
  id int primary key default 1 check (id = 1),
  pinged_at timestamptz not null default now()
);

-- RLS on with no policies = anon/authenticated can't read or write it
-- directly. The only way in is the function below.
alter table keepalive enable row level security;

-- `security definer` runs as the function's owner, so it can write past RLS.
-- `set search_path` pins name lookup so nobody can shadow `keepalive` with
-- their own table — standard hygiene for security definer functions.
create or replace function public.keepalive()
returns timestamptz
language plpgsql
security definer
set search_path = public
as $$
declare
  ts timestamptz;
begin
  -- Upsert: inserts the row on the first ping, bumps it on every later one.
  -- One atomic statement, so two overlapping pings can't race.
  insert into keepalive (id, pinged_at)
  values (1, now())
  on conflict (id) do update set pinged_at = excluded.pinged_at
  returning pinged_at into ts;

  return ts;
end;
$$;

-- Only allow the anon role (the key the Action uses) to call it.
revoke all on function public.keepalive() from public;
grant execute on function public.keepalive() to anon;
