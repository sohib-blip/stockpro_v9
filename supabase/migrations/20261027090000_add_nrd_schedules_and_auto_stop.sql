begin;

-- NRD scheduled tasks (e.g. Team Meeting from 09:00 to 09:30): once on a date
-- or every week on a weekday. Each user schedules for themselves; the API
-- starts and stops the task automatically. Every NRD task stops at 17:00
-- (Europe/Brussels), so a schedule must end by then.
create table if not exists public.nrd_schedules (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references auth.users(id) on delete cascade,
  user_email text not null,
  task text not null check (char_length(btrim(task)) between 1 and 120),
  repeat text not null check (repeat in ('once', 'weekly')),
  schedule_date date,
  -- ISO weekday: 1 = Monday ... 7 = Sunday.
  weekday smallint check (weekday between 1 and 7),
  start_time time not null,
  end_time time not null,
  created_at timestamptz not null default now(),
  constraint nrd_schedules_when_check check (
    (repeat = 'once' and schedule_date is not null and weekday is null)
    or (repeat = 'weekly' and weekday is not null and schedule_date is null)
  ),
  constraint nrd_schedules_times_check check (
    end_time > start_time and end_time <= time '17:00'
  )
);

create index if not exists nrd_schedules_user_idx
  on public.nrd_schedules (user_email);

alter table public.nrd_schedules enable row level security;
revoke all on table public.nrd_schedules from public, anon, authenticated;
grant select, insert, update, delete on table public.nrd_schedules to service_role;

-- A log created by a schedule keeps its occurrence (one per schedule and day);
-- auto_stopped marks tasks closed by the 17:00 stop.
alter table public.nrd_time_logs
  add column if not exists schedule_id uuid
    references public.nrd_schedules(id) on delete set null,
  add column if not exists schedule_date date,
  add column if not exists auto_stopped boolean not null default false;

create unique index if not exists nrd_time_logs_schedule_occurrence_unique
  on public.nrd_time_logs (schedule_id, schedule_date)
  where schedule_id is not null;

commit;
