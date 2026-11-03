-- Dispatch Planning: today's plan, its planner lock and the order assignments.
--
-- The person who previews the daily workbook becomes today's planner. While
-- the plan is OPEN, no other account can preview or confirm a workbook (no
-- double work). The lock ends when the planner confirms the packaging
-- deduction, when the planner releases it, at the end of the day (a plan only
-- locks on its own plan_date) or when an admin takes over.
--
-- The plan keeps every order with its device models and every vehicle
-- registration label, so each person can download the Word labels of the
-- orders assigned to them without having the workbook.

begin;

create table if not exists public.dispatch_plans (
  id uuid primary key default gen_random_uuid(),
  plan_date date not null,
  status text not null default 'OPEN' check (
    status in ('OPEN', 'CONFIRMED', 'RELEASED', 'REPLACED')
  ),
  planner_id uuid references auth.users(id) on delete set null,
  planner_email text not null,
  source_sha256 text not null check (source_sha256 ~ '^[a-f0-9]{64}$'),
  source_filename text not null check (
    char_length(btrim(source_filename)) between 1 and 255
  ),
  orders jsonb not null check (jsonb_typeof(orders) = 'array'),
  labels jsonb not null check (jsonb_typeof(labels) = 'array'),
  started_at timestamptz not null default now(),
  closed_at timestamptz,
  closed_by_email text,
  created_at timestamptz not null default now()
);

-- One planner at a time per day.
create unique index if not exists dispatch_plans_one_open_per_day
  on public.dispatch_plans (plan_date)
  where status = 'OPEN';
create index if not exists dispatch_plans_day_idx
  on public.dispatch_plans (plan_date desc, created_at desc);

create table if not exists public.dispatch_plan_assignments (
  plan_id uuid not null references public.dispatch_plans(id) on delete cascade,
  order_id text not null check (char_length(btrim(order_id)) between 1 and 500),
  assignee_id uuid not null references auth.users(id) on delete cascade,
  assignee_email text not null,
  assigned_by_email text not null,
  assigned_at timestamptz not null default now(),
  primary key (plan_id, order_id)
);
create index if not exists dispatch_plan_assignments_assignee_idx
  on public.dispatch_plan_assignments (assignee_id, plan_id);

alter table public.dispatch_plans enable row level security;
alter table public.dispatch_plan_assignments enable row level security;
revoke all on table public.dispatch_plans from public, anon, authenticated;
revoke all on table public.dispatch_plan_assignments from public, anon, authenticated;
grant select, insert, update, delete on table public.dispatch_plans to service_role;
grant select, insert, update, delete on table public.dispatch_plan_assignments to service_role;

-- Starts (or resumes) today's plan for the planner, atomically:
--   LOCKED            another account holds today's open plan
--   REPLACE_REQUIRED  the planner has an open plan for another workbook
--                     (p_replace = true replaces it and drops its assignments)
-- The same workbook resumes the existing plan and keeps its assignments.
create or replace function public.start_dispatch_plan(
  p_plan_date date,
  p_planner_id uuid,
  p_planner_email text,
  p_source_sha256 text,
  p_source_filename text,
  p_orders jsonb,
  p_labels jsonb,
  p_replace boolean default false
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  v_open public.dispatch_plans%rowtype;
  v_same public.dispatch_plans%rowtype;
  v_assignments integer;
  v_id uuid;
begin
  perform pg_advisory_xact_lock(hashtext('stockpro.dispatch_plan'));

  -- An open plan from an earlier day no longer locks anything.
  update public.dispatch_plans
     set status = 'RELEASED',
         closed_at = now(),
         closed_by_email = 'end of day'
   where status = 'OPEN'
     and plan_date < p_plan_date;

  select * into v_open
    from public.dispatch_plans
   where status = 'OPEN'
     and plan_date = p_plan_date
   for update;

  if found then
    if v_open.planner_id is distinct from p_planner_id then
      return jsonb_build_object(
        'ok', false,
        'code', 'LOCKED',
        'planner_email', v_open.planner_email,
        'started_at', v_open.started_at
      );
    end if;

    if v_open.source_sha256 = p_source_sha256 then
      return jsonb_build_object(
        'ok', true, 'plan_id', v_open.id, 'status', v_open.status, 'resumed', true
      );
    end if;

    if not coalesce(p_replace, false) then
      select count(*) into v_assignments
        from public.dispatch_plan_assignments
       where plan_id = v_open.id;
      return jsonb_build_object(
        'ok', false,
        'code', 'REPLACE_REQUIRED',
        'source_filename', v_open.source_filename,
        'assignment_count', v_assignments
      );
    end if;

    update public.dispatch_plans
       set status = 'REPLACED',
           closed_at = now(),
           closed_by_email = p_planner_email
     where id = v_open.id;
  else
    select * into v_same
      from public.dispatch_plans
     where plan_date = p_plan_date
       and status in ('CONFIRMED', 'RELEASED')
       and source_sha256 = p_source_sha256
     order by created_at desc
     limit 1;
    -- Today's workbook was already confirmed: show that plan again (its
    -- assignments and labels) without locking the other accounts.
    if found and v_same.status = 'CONFIRMED' then
      return jsonb_build_object(
        'ok', true, 'plan_id', v_same.id, 'status', v_same.status, 'resumed', true
      );
    end if;
    -- A planning ended without deduction reopens for whoever imports the
    -- same workbook again, with its assignments.
    if found then
      update public.dispatch_plans
         set status = 'OPEN',
             planner_id = p_planner_id,
             planner_email = p_planner_email,
             started_at = now(),
             closed_at = null,
             closed_by_email = null
       where id = v_same.id;
      return jsonb_build_object(
        'ok', true, 'plan_id', v_same.id, 'status', 'OPEN', 'resumed', true
      );
    end if;
  end if;

  insert into public.dispatch_plans (
    plan_date, status, planner_id, planner_email,
    source_sha256, source_filename, orders, labels
  )
  values (
    p_plan_date, 'OPEN', p_planner_id, p_planner_email,
    p_source_sha256, p_source_filename, p_orders, p_labels
  )
  returning id into v_id;

  return jsonb_build_object('ok', true, 'plan_id', v_id, 'status', 'OPEN', 'resumed', false);
end;
$$;

revoke all on function public.start_dispatch_plan(
  date, uuid, text, text, text, jsonb, jsonb, boolean
) from public, anon, authenticated;
grant execute on function public.start_dispatch_plan(
  date, uuid, text, text, text, jsonb, jsonb, boolean
) to service_role;

commit;

notify pgrst, 'reload schema';
