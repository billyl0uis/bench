-- Bench schema
-- Run this once in the Supabase SQL editor (Project > SQL Editor > New query).

create table if not exists days (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  date date not null,
  committed boolean not null default false,
  shutdown_done boolean not null default false,
  focus_task_id uuid,
  reflection text not null default '',
  created_at timestamptz not null default now(),
  unique (user_id, date)
);

create table if not exists tasks (
  id uuid primary key default gen_random_uuid(),
  day_id uuid not null references days(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  title text not null,
  est_minutes int not null default 30,
  start_time text,          -- 'HH:MM' or null
  done boolean not null default false,
  focused_seconds int not null default 0,
  sort_order int not null default 0,
  created_at timestamptz not null default now()
);

create table if not exists chat_messages (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  role text not null check (role in ('user', 'assistant')),
  content text not null,
  created_at timestamptz not null default now()
);

alter table days enable row level security;
alter table tasks enable row level security;
alter table chat_messages enable row level security;

-- Users can only ever see/write their own rows.
create policy "days: owner only" on days
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

create policy "tasks: owner only" on tasks
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

create policy "chat_messages: owner only" on chat_messages
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

create index if not exists idx_days_user_date on days(user_id, date desc);
create index if not exists idx_tasks_day on tasks(day_id);
