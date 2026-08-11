begin;

-- Shared admission state is deliberately small, stores only HMAC digests and
-- is reachable only through service-role server routes.
create table public.workload_budget_buckets (
  route_class text not null
    check (char_length(route_class) between 1 and 100),
  scope text not null
    check (scope in ('global', 'principal', 'source')),
  scope_key_hash text not null
    check (
      scope_key_hash = 'global'
      or scope_key_hash ~ '^[0-9a-f]{64}$'
    ),
  window_started_at timestamptz not null,
  used integer not null default 0 check (used >= 0),
  primary key (route_class, scope, scope_key_hash, window_started_at)
);

create table public.workload_leases (
  id uuid primary key default gen_random_uuid(),
  route_class text not null
    check (char_length(route_class) between 1 and 100),
  principal_hash text not null
    check (principal_hash ~ '^[0-9a-f]{64}$'),
  source_hash text not null
    check (source_hash ~ '^[0-9a-f]{64}$'),
  acquired_at timestamptz not null default clock_timestamp(),
  expires_at timestamptz not null,
  check (expires_at > acquired_at)
);

create index workload_budget_buckets_window_idx
  on public.workload_budget_buckets (window_started_at);
create index workload_leases_active_idx
  on public.workload_leases (expires_at, route_class);
create index workload_leases_route_active_idx
  on public.workload_leases (route_class, expires_at);
create index workload_leases_principal_active_idx
  on public.workload_leases (route_class, principal_hash, expires_at);

alter table public.workload_budget_buckets enable row level security;
alter table public.workload_leases enable row level security;

revoke all on table public.workload_budget_buckets
  from public, anon, authenticated;
revoke all on table public.workload_leases
  from public, anon, authenticated;
grant select, insert, update, delete
  on table public.workload_budget_buckets
  to service_role;
grant select, insert, update, delete
  on table public.workload_leases
  to service_role;

create or replace function public.acquire_workload_lease(
  p_route_class text,
  p_principal_hash text,
  p_source_hash text,
  p_window_seconds integer,
  p_principal_limit integer,
  p_source_limit integer,
  p_global_limit integer,
  p_principal_concurrency integer,
  p_route_concurrency integer,
  p_global_concurrency integer,
  p_lease_seconds integer
)
returns table (
  allowed boolean,
  lease_id uuid,
  retry_after_seconds integer,
  reason text
)
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  v_now timestamptz := clock_timestamp();
  v_window timestamptz;
  v_principal_used integer;
  v_source_used integer;
  v_global_used integer;
  v_principal_active integer;
  v_route_active integer;
  v_global_active integer;
  v_lease_id uuid;
  v_retry integer;
begin
  if nullif(btrim(p_route_class), '') is null
    or char_length(p_route_class) > 100
    or p_principal_hash !~ '^[0-9a-f]{64}$'
    or p_source_hash !~ '^[0-9a-f]{64}$'
    or p_window_seconds not between 1 and 3600
    or p_principal_limit not between 1 and 100000
    or p_source_limit not between 1 and 100000
    or p_global_limit not between 1 and 1000000
    or p_principal_concurrency not between 1 and 1000
    or p_route_concurrency not between 1 and 1000
    or p_global_concurrency not between 1 and 10000
    or p_principal_concurrency > p_route_concurrency
    or p_route_concurrency > p_global_concurrency
    or p_lease_seconds not between 1 and 900 then
    raise exception 'WORKLOAD_POLICY_INVALID' using errcode = '22023';
  end if;

  v_window := to_timestamp(
    floor(extract(epoch from v_now) / p_window_seconds) * p_window_seconds
  );
  v_retry := greatest(
    1,
    ceil(
      extract(
        epoch from (
          v_window
          + p_window_seconds * interval '1 second'
          - v_now
        )
      )
    )::integer
  );

  -- A consistent lock order makes the rate and concurrency decision atomic
  -- across routes and serverless instances.
  perform pg_advisory_xact_lock(
    hashtextextended('stockpro-workload:global', 0)
  );
  perform pg_advisory_xact_lock(
    hashtextextended('stockpro-workload:' || p_route_class, 0)
  );

  select coalesce(max(b.used), 0)
  into v_principal_used
  from public.workload_budget_buckets b
  where b.route_class = p_route_class
    and b.scope = 'principal'
    and b.scope_key_hash = p_principal_hash
    and b.window_started_at = v_window;

  select coalesce(max(b.used), 0)
  into v_source_used
  from public.workload_budget_buckets b
  where b.route_class = p_route_class
    and b.scope = 'source'
    and b.scope_key_hash = p_source_hash
    and b.window_started_at = v_window;

  select coalesce(max(b.used), 0)
  into v_global_used
  from public.workload_budget_buckets b
  where b.route_class = p_route_class
    and b.scope = 'global'
    and b.scope_key_hash = 'global'
    and b.window_started_at = v_window;

  if v_principal_used >= p_principal_limit
    or v_source_used >= p_source_limit
    or v_global_used >= p_global_limit then
    return query
      select false, null::uuid, v_retry, 'rate_limited'::text;
    return;
  end if;

  select count(*)::integer
  into v_global_active
  from public.workload_leases l
  where l.expires_at > v_now;

  select count(*)::integer
  into v_route_active
  from public.workload_leases l
  where l.route_class = p_route_class
    and l.expires_at > v_now;

  select count(*)::integer
  into v_principal_active
  from public.workload_leases l
  where l.route_class = p_route_class
    and l.principal_hash = p_principal_hash
    and l.expires_at > v_now;

  if v_principal_active >= p_principal_concurrency
    or v_route_active >= p_route_concurrency
    or v_global_active >= p_global_concurrency then
    return query
      select false, null::uuid, 2, 'concurrency_limited'::text;
    return;
  end if;

  insert into public.workload_budget_buckets (
    route_class,
    scope,
    scope_key_hash,
    window_started_at,
    used
  )
  values
    (p_route_class, 'global', 'global', v_window, 1),
    (p_route_class, 'principal', p_principal_hash, v_window, 1),
    (p_route_class, 'source', p_source_hash, v_window, 1)
  on conflict (route_class, scope, scope_key_hash, window_started_at)
  do update set used = public.workload_budget_buckets.used + 1;

  insert into public.workload_leases (
    route_class,
    principal_hash,
    source_hash,
    acquired_at,
    expires_at
  )
  values (
    p_route_class,
    p_principal_hash,
    p_source_hash,
    v_now,
    v_now + p_lease_seconds * interval '1 second'
  )
  returning id into v_lease_id;

  return query select true, v_lease_id, 0, 'admitted'::text;
end;
$$;

create or replace function public.release_workload_lease(
  p_lease_id uuid
)
returns boolean
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  v_deleted integer;
begin
  if p_lease_id is null then
    return false;
  end if;

  delete from public.workload_leases
  where id = p_lease_id;
  get diagnostics v_deleted = row_count;
  return v_deleted = 1;
end;
$$;

-- A compact operation-level history prevents a 50-row response from
-- materializing the lifetime RETURN movement table in the application.
create table public.return_history_entries (
  history_key text primary key,
  operation_id uuid unique null
    references public.inventory_command_receipts(operation_id)
    on delete cascade,
  created_at timestamptz not null,
  actor text not null default 'unknown',
  return_ref text not null default '',
  return_type text not null default '',
  return_reason text not null default '',
  qty integer not null check (qty >= 0)
);

create index return_history_entries_cursor_idx
  on public.return_history_entries (created_at desc, history_key desc);

alter table public.return_history_entries enable row level security;
revoke all on table public.return_history_entries
  from public, anon, authenticated;
grant select, insert, update, delete
  on table public.return_history_entries
  to service_role;

insert into public.return_history_entries (
  history_key,
  operation_id,
  created_at,
  actor,
  return_ref,
  return_type,
  return_reason,
  qty
)
select
  coalesce(
    m.operation_id::text,
    nullif(m.shipment_ref, ''),
    m.movement_id::text
  ) as history_key,
  (array_agg(receipt.operation_id)
    filter (where receipt.operation_id is not null))[1],
  max(m.created_at),
  coalesce(
    (array_agg(nullif(m.actor, '') order by m.created_at desc)
      filter (where nullif(m.actor, '') is not null))[1],
    'unknown'
  ),
  coalesce(
    (array_agg(nullif(m.shipment_ref, '') order by m.created_at desc)
      filter (where nullif(m.shipment_ref, '') is not null))[1],
    ''
  ),
  coalesce(
    (array_agg(nullif(m.return_type, '') order by m.created_at desc)
      filter (where nullif(m.return_type, '') is not null))[1],
    ''
  ),
  coalesce(
    (array_agg(nullif(m.return_reason, '') order by m.created_at desc)
      filter (where nullif(m.return_reason, '') is not null))[1],
    ''
  ),
  case
    when count(distinct nullif(m.imei, '')) > 0
      then count(distinct nullif(m.imei, ''))::integer
    else coalesce(sum(coalesce(m.qty, 1)), 0)::integer
  end
from public.movements m
left join public.inventory_command_receipts receipt
  on receipt.operation_id = m.operation_id
where m.type = 'RETURN'
group by coalesce(
  m.operation_id::text,
  nullif(m.shipment_ref, ''),
  m.movement_id::text
)
on conflict (history_key) do update
set operation_id = excluded.operation_id,
    created_at = excluded.created_at,
    actor = excluded.actor,
    return_ref = excluded.return_ref,
    return_type = excluded.return_type,
    return_reason = excluded.return_reason,
    qty = excluded.qty;

create or replace function public.sync_return_history_receipt()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
begin
  if new.command_type <> 'return' or new.result is null then
    return new;
  end if;

  insert into public.return_history_entries (
    history_key,
    operation_id,
    created_at,
    actor,
    return_ref,
    return_type,
    return_reason,
    qty
  )
  select
    new.operation_id::text,
    new.operation_id,
    max(m.created_at),
    coalesce(
      (array_agg(nullif(m.actor, '') order by m.created_at desc)
        filter (where nullif(m.actor, '') is not null))[1],
      'unknown'
    ),
    coalesce(
      (array_agg(nullif(m.shipment_ref, '') order by m.created_at desc)
        filter (where nullif(m.shipment_ref, '') is not null))[1],
      ''
    ),
    coalesce(
      (array_agg(nullif(m.return_type, '') order by m.created_at desc)
        filter (where nullif(m.return_type, '') is not null))[1],
      ''
    ),
    coalesce(
      (array_agg(nullif(m.return_reason, '') order by m.created_at desc)
        filter (where nullif(m.return_reason, '') is not null))[1],
      ''
    ),
    case
      when count(distinct nullif(m.imei, '')) > 0
        then count(distinct nullif(m.imei, ''))::integer
      else coalesce(sum(coalesce(m.qty, 1)), 0)::integer
    end
  from public.movements m
  where m.type = 'RETURN'
    and m.operation_id = new.operation_id
  having count(*) > 0
  on conflict (history_key) do update
  set created_at = excluded.created_at,
      actor = excluded.actor,
      return_ref = excluded.return_ref,
      return_type = excluded.return_type,
      return_reason = excluded.return_reason,
      qty = excluded.qty;

  return new;
end;
$$;

drop trigger if exists inventory_receipt_return_history
  on public.inventory_command_receipts;
create trigger inventory_receipt_return_history
after update of result on public.inventory_command_receipts
for each row
when (
  new.command_type = 'return'
  and new.result is not null
)
execute function public.sync_return_history_receipt();

create or replace function public.get_return_history_page(
  p_cursor_created_at timestamptz default null,
  p_cursor_history_key text default null,
  p_limit integer default 51
)
returns table (
  history_key text,
  operation_id uuid,
  created_at timestamptz,
  actor text,
  return_ref text,
  return_type text,
  return_reason text,
  qty integer
)
language sql
security definer
set search_path = pg_catalog, public
as $$
  select
    h.history_key,
    h.operation_id,
    h.created_at,
    h.actor,
    h.return_ref,
    h.return_type,
    h.return_reason,
    h.qty
  from public.return_history_entries h
  where (
    p_cursor_created_at is null
    and p_cursor_history_key is null
  ) or (
    p_cursor_created_at is not null
    and p_cursor_history_key is not null
    and (h.created_at, h.history_key)
      < (p_cursor_created_at, p_cursor_history_key)
  )
  order by h.created_at desc, h.history_key desc
  limit least(greatest(coalesce(p_limit, 51), 1), 51);
$$;

-- Both preview helpers keep query count constant as the admitted selection
-- grows. Route-level limits still bound the array cardinality.
create or replace function public.preview_box_transfer(
  p_box_codes text[],
  p_source_bin_id uuid,
  p_target_floor text
)
returns table (
  box_id uuid,
  box_code text,
  current_floor text,
  device text,
  imei_count bigint
)
language sql
security definer
set search_path = pg_catalog, public
as $$
  select
    b.id,
    b.box_code,
    b.floor,
    coalesce(bn.name, 'Unknown'),
    count(i.item_id) filter (where upper(i.status) = 'IN')
  from public.boxes b
  left join public.bins bn on bn.id = b.bin_id
  left join public.items i on i.box_id = b.id
  where b.bin_id = p_source_bin_id
    and b.box_code = any(p_box_codes)
  group by b.id, b.box_code, b.floor, bn.name
  order by b.box_code;
$$;

create or replace function public.get_outbound_box_stock_counts(
  p_box_ids uuid[]
)
returns table (
  box_id uuid,
  stock_count bigint
)
language sql
security definer
set search_path = pg_catalog, public
as $$
  select
    requested.box_id,
    count(i.item_id) filter (where upper(i.status) = 'IN')
  from unnest(p_box_ids) as requested(box_id)
  left join public.items i on i.box_id = requested.box_id
  group by requested.box_id;
$$;

create or replace function public.get_latest_outbound_movements(
  p_imeis text[]
)
returns table (
  imei text,
  created_at timestamptz,
  shipment_ref text,
  source text,
  device text,
  box_code text,
  floor text
)
language sql
security definer
set search_path = pg_catalog, public
as $$
  select distinct on (m.imei)
    m.imei,
    m.created_at,
    m.shipment_ref,
    m.source,
    coalesce(bn.name, ''),
    coalesce(b.box_code, ''),
    coalesce(b.floor, '')
  from public.movements m
  left join public.boxes b on b.id = m.box_id
  left join public.bins bn on bn.id = m.device_id
  where m.type = 'OUT'
    and m.imei = any(p_imeis)
  order by m.imei, m.created_at desc, m.movement_id desc;
$$;

create or replace function public.run_workload_maintenance()
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  v_buckets integer;
  v_leases integer;
  v_connection_events integer;
begin
  delete from public.workload_budget_buckets
  where window_started_at < clock_timestamp() - interval '1 day';
  get diagnostics v_buckets = row_count;

  delete from public.workload_leases
  where expires_at < clock_timestamp() - interval '1 hour';
  get diagnostics v_leases = row_count;

  delete from public.connection_events
  where created_at < clock_timestamp() - interval '90 days';
  get diagnostics v_connection_events = row_count;

  return jsonb_build_object(
    'budget_buckets_deleted', v_buckets,
    'leases_deleted', v_leases,
    'connection_events_deleted', v_connection_events
  );
end;
$$;

revoke all on function public.acquire_workload_lease(
  text, text, text, integer, integer, integer, integer, integer, integer,
  integer, integer
) from public, anon, authenticated;
grant execute on function public.acquire_workload_lease(
  text, text, text, integer, integer, integer, integer, integer, integer,
  integer, integer
) to service_role;

revoke all on function public.release_workload_lease(uuid)
  from public, anon, authenticated;
grant execute on function public.release_workload_lease(uuid)
  to service_role;

revoke all on function public.sync_return_history_receipt()
  from public, anon, authenticated;

revoke all on function public.get_return_history_page(
  timestamptz, text, integer
) from public, anon, authenticated;
grant execute on function public.get_return_history_page(
  timestamptz, text, integer
) to service_role;

revoke all on function public.preview_box_transfer(text[], uuid, text)
  from public, anon, authenticated;
grant execute on function public.preview_box_transfer(text[], uuid, text)
  to service_role;

revoke all on function public.get_outbound_box_stock_counts(uuid[])
  from public, anon, authenticated;
grant execute on function public.get_outbound_box_stock_counts(uuid[])
  to service_role;

revoke all on function public.get_latest_outbound_movements(text[])
  from public, anon, authenticated;
grant execute on function public.get_latest_outbound_movements(text[])
  to service_role;

revoke all on function public.run_workload_maintenance()
  from public, anon, authenticated;
grant execute on function public.run_workload_maintenance()
  to service_role;

comment on table public.workload_budget_buckets is
  'HMAC-keyed fixed-window counters for StockPro shared workload admission.';
comment on table public.workload_leases is
  'Expiring cross-instance leases for bounded StockPro concurrency.';
comment on table public.return_history_entries is
  'Operation-level RETURN history used for bounded cursor pagination.';

commit;
