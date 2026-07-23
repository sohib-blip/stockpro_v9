begin;

create table if not exists public.connection_events (
  id uuid primary key default gen_random_uuid(),
  user_id uuid null references auth.users(id) on delete set null,
  email text not null check (char_length(email) between 3 and 320),
  successful boolean not null,
  failure_reason text null,
  takeover boolean not null default false,
  ip_address inet null,
  country_code text null check (
    country_code is null or country_code ~ '^[A-Z]{2}$'
  ),
  region text null,
  city text null,
  device text not null default 'Computer',
  browser text not null default 'Unknown browser',
  operating_system text not null default 'Unknown OS',
  user_agent text null,
  created_at timestamptz not null default now()
);

create index if not exists connection_events_created_at_idx
  on public.connection_events (created_at desc);
create index if not exists connection_events_email_created_at_idx
  on public.connection_events (email, created_at desc);
create index if not exists connection_events_user_created_at_idx
  on public.connection_events (user_id, created_at desc)
  where user_id is not null;

alter table public.connection_events enable row level security;

-- Connection metadata includes personal data. It is accessible only through
-- authenticated server routes guarded by the StockPro administrator role.
revoke all privileges on table public.connection_events
  from public, anon, authenticated;
grant all privileges on table public.connection_events to service_role;

comment on table public.connection_events is
  'Admin-only StockPro authentication log. Application retention: 90 days.';

commit;
