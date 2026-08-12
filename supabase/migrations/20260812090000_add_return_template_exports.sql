begin;

-- A successful template download claims return rows exactly once. The batch is
-- retained as an audit marker while individual operations remain re-exportable.
create table if not exists public.return_template_export_batches (
  id uuid primary key,
  created_at timestamptz not null default now(),
  actor_id uuid references auth.users(id) on delete set null,
  actor text not null,
  row_count integer not null default 0 check (row_count >= 0)
);

alter table public.return_template_export_batches enable row level security;
revoke all on table public.return_template_export_batches
  from public, anon, authenticated;
grant select, insert, update, delete
  on table public.return_template_export_batches
  to service_role;

alter table public.return_records
  add column if not exists template_export_batch_id uuid
    references public.return_template_export_batches(id) on delete set null,
  add column if not exists template_exported_at timestamptz,
  add column if not exists template_exported_by uuid
    references auth.users(id) on delete set null,
  add column if not exists template_exported_by_email text;

create index if not exists return_records_pending_template_export_idx
  on public.return_records (created_at, id)
  where template_exported_at is null;

create index if not exists return_records_template_export_batch_idx
  on public.return_records (template_export_batch_id)
  where template_export_batch_id is not null;

create or replace function public.claim_return_template_export_batch(
  p_batch_id uuid,
  p_actor_id uuid,
  p_actor text,
  p_limit integer default 50000
)
returns table (
  id uuid,
  operation_id uuid,
  created_at timestamptz,
  return_status text,
  imei text
)
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  v_claimed integer;
  v_now timestamptz := clock_timestamp();
begin
  if p_batch_id is null
    or p_actor_id is null
    or nullif(btrim(coalesce(p_actor, '')), '') is null then
    raise exception 'RETURN_TEMPLATE_EXPORT_IDENTITY_REQUIRED'
      using errcode = '22023';
  end if;

  if p_limit is null or p_limit not between 1 and 50000 then
    raise exception 'RETURN_TEMPLATE_EXPORT_LIMIT_INVALID'
      using errcode = '22023';
  end if;

  insert into public.return_template_export_batches (
    id,
    created_at,
    actor_id,
    actor,
    row_count
  )
  values (
    p_batch_id,
    v_now,
    p_actor_id,
    btrim(p_actor),
    0
  );

  return query
  with pending as (
    select r.id
    from public.return_records r
    where r.template_exported_at is null
    order by r.created_at, r.id
    for update of r skip locked
    limit p_limit
  ), claimed as (
    update public.return_records r
    set template_export_batch_id = p_batch_id,
        template_exported_at = v_now,
        template_exported_by = p_actor_id,
        template_exported_by_email = btrim(p_actor)
    from pending
    where r.id = pending.id
    returning r.id, r.operation_id, r.created_at, r.return_status, r.imei
  )
  select c.id, c.operation_id, c.created_at, c.return_status, c.imei
  from claimed c
  order by c.created_at, c.id;

  get diagnostics v_claimed = row_count;

  if v_claimed = 0 then
    delete from public.return_template_export_batches
    where return_template_export_batches.id = p_batch_id;
  else
    update public.return_template_export_batches
    set row_count = v_claimed
    where return_template_export_batches.id = p_batch_id;
  end if;
end;
$$;

revoke all on function public.claim_return_template_export_batch(
  uuid, uuid, text, integer
) from public, anon, authenticated;
grant execute on function public.claim_return_template_export_batch(
  uuid, uuid, text, integer
) to service_role;

create or replace function public.release_return_template_export_batch(
  p_batch_id uuid,
  p_actor_id uuid
)
returns integer
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  v_released integer;
begin
  if p_batch_id is null or p_actor_id is null then
    raise exception 'RETURN_TEMPLATE_EXPORT_IDENTITY_REQUIRED'
      using errcode = '22023';
  end if;

  update public.return_records r
  set template_export_batch_id = null,
      template_exported_at = null,
      template_exported_by = null,
      template_exported_by_email = null
  where r.template_export_batch_id = p_batch_id
    and r.template_exported_by = p_actor_id;

  get diagnostics v_released = row_count;

  delete from public.return_template_export_batches b
  where b.id = p_batch_id
    and b.actor_id = p_actor_id;

  return v_released;
end;
$$;

revoke all on function public.release_return_template_export_batch(
  uuid, uuid
) from public, anon, authenticated;
grant execute on function public.release_return_template_export_batch(
  uuid, uuid
) to service_role;

comment on function public.claim_return_template_export_batch(
  uuid, uuid, text, integer
) is
  'Atomically claims previously unexported customer-return rows for one template download.';

comment on function public.release_return_template_export_batch(
  uuid, uuid
) is
  'Releases a claimed template export only when workbook generation fails before delivery.';

commit;
