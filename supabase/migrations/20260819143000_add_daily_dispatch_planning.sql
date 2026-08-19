begin;

alter table public.packaging_stock_movements
  drop constraint if exists packaging_stock_movements_movement_type_check;
alter table public.packaging_stock_movements
  add constraint packaging_stock_movements_movement_type_check
  check (
    movement_type in (
      'RECEIVE',
      'REMOVE',
      'COUNT_ADJUSTMENT',
      'RESERVE',
      'RELEASE',
      'CONSUME',
      'UNDO_CONSUME'
    )
  );

create table if not exists public.dispatch_batches (
  id uuid primary key default gen_random_uuid(),
  operation_id uuid not null unique,
  source_sha256 text not null check (source_sha256 ~ '^[a-f0-9]{64}$'),
  source_filename text not null check (
    char_length(btrim(source_filename)) between 1 and 255
  ),
  source_generated_at text,
  status text not null default 'CONFIRMED' check (
    status in ('CONFIRMED', 'UNDONE')
  ),
  order_ids text[] not null check (cardinality(order_ids) between 1 and 5000),
  orders jsonb not null check (jsonb_typeof(orders) = 'array'),
  package_usage jsonb not null check (jsonb_typeof(package_usage) = 'array'),
  order_count integer not null check (order_count between 1 and 5000),
  line_count integer not null check (line_count between 1 and 50000),
  total_packages integer not null check (total_packages between 1 and 1000000),
  actor_id uuid references auth.users(id) on delete set null,
  actor_email text not null,
  confirmed_at timestamptz not null default now(),
  undone_at timestamptz,
  undone_by_id uuid references auth.users(id) on delete set null,
  undone_by_email text,
  created_at timestamptz not null default now()
);

create unique index if not exists dispatch_batches_confirmed_source_unique
  on public.dispatch_batches (source_sha256)
  where status = 'CONFIRMED';
create index if not exists dispatch_batches_confirmed_orders_idx
  on public.dispatch_batches using gin (order_ids)
  where status = 'CONFIRMED';
create index if not exists dispatch_batches_history_idx
  on public.dispatch_batches (confirmed_at desc, id desc);

alter table public.dispatch_batches enable row level security;
revoke all on table public.dispatch_batches
  from public, anon, authenticated;
grant select, insert, update, delete on table public.dispatch_batches
  to service_role;

create or replace function public.confirm_dispatch_batch(
  p_operation_id uuid,
  p_actor_id uuid,
  p_actor text,
  p_source_sha256 text,
  p_source_filename text,
  p_source_generated_at text,
  p_orders jsonb,
  p_package_usage jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  v_receipt_inserted integer;
  v_existing_command text;
  v_existing_actor uuid;
  v_existing_result jsonb;
  v_order_ids text[];
  v_order_count integer;
  v_line_count integer;
  v_total_packages integer;
  v_batch_id uuid;
  v_usage jsonb;
  v_packaging public.packaging_types%rowtype;
  v_packaging_id uuid;
  v_quantity integer;
  v_after integer;
  v_result jsonb;
  v_now timestamptz := clock_timestamp();
begin
  if p_operation_id is null
    or p_actor_id is null
    or nullif(btrim(coalesce(p_actor, '')), '') is null then
    raise exception 'DISPATCH_IDENTITY_REQUIRED' using errcode = '22023';
  end if;

  if coalesce(p_source_sha256, '') !~ '^[a-f0-9]{64}$'
    or nullif(btrim(coalesce(p_source_filename, '')), '') is null
    or char_length(btrim(p_source_filename)) > 255
    or jsonb_typeof(p_orders) is distinct from 'array'
    or jsonb_typeof(p_package_usage) is distinct from 'array' then
    raise exception 'DISPATCH_PAYLOAD_INVALID' using errcode = '22023';
  end if;

  v_order_count := jsonb_array_length(p_orders);
  select coalesce(array_agg(order_id order by order_id), '{}'),
         coalesce(sum(line_count), 0)
  into v_order_ids, v_line_count
  from (
    select nullif(btrim(value ->> 'orderId'), '') as order_id,
           coalesce((value ->> 'lineCount')::integer, 0) as line_count
    from jsonb_array_elements(p_orders)
  ) parsed;

  select coalesce(sum((value ->> 'quantity')::integer), 0)
  into v_total_packages
  from jsonb_array_elements(p_package_usage);

  if v_order_count not between 1 and 5000
    or cardinality(v_order_ids) <> v_order_count
    or exists (select 1 from unnest(v_order_ids) value where value is null)
    or cardinality(array(select distinct value from unnest(v_order_ids) value)) <> v_order_count
    or v_line_count not between 1 and 50000
    or jsonb_array_length(p_package_usage) not between 1 and 100
    or v_total_packages not between 1 and 1000000 then
    raise exception 'DISPATCH_PAYLOAD_INVALID' using errcode = '22023';
  end if;

  insert into public.inventory_command_receipts (
    operation_id,
    command_type,
    actor_id
  ) values (
    p_operation_id,
    'dispatch_confirm',
    p_actor_id
  )
  on conflict (operation_id) do nothing;

  get diagnostics v_receipt_inserted = row_count;
  if v_receipt_inserted = 0 then
    select receipt.command_type, receipt.actor_id, receipt.result
    into v_existing_command, v_existing_actor, v_existing_result
    from public.inventory_command_receipts receipt
    where receipt.operation_id = p_operation_id;

    if v_existing_command is distinct from 'dispatch_confirm'
      or v_existing_actor is distinct from p_actor_id then
      raise exception 'OPERATION_ID_CONFLICT' using errcode = '23505';
    end if;
    if v_existing_result is null then
      raise exception 'OPERATION_RESULT_UNAVAILABLE' using errcode = '40001';
    end if;
    return v_existing_result;
  end if;

  perform pg_advisory_xact_lock(hashtext('stockpro-dispatch-planning'));

  if exists (
    select 1
    from public.dispatch_batches batch
    where batch.status = 'CONFIRMED'
      and batch.source_sha256 = p_source_sha256
  ) then
    raise exception 'DISPATCH_SOURCE_ALREADY_CONFIRMED' using errcode = '23505';
  end if;

  if exists (
    select 1
    from public.dispatch_batches batch
    where batch.status = 'CONFIRMED'
      and batch.order_ids && v_order_ids
  ) then
    raise exception 'DISPATCH_ORDERS_ALREADY_CONFIRMED' using errcode = '23505';
  end if;

  for v_usage in select value from jsonb_array_elements(p_package_usage)
  loop
    if coalesce(v_usage ->> 'packagingTypeId', '') !~
        '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
      or coalesce(v_usage ->> 'quantity', '') !~ '^[1-9][0-9]{0,6}$' then
      raise exception 'DISPATCH_PACKAGING_INVALID' using errcode = '22023';
    end if;

    v_packaging_id := (v_usage ->> 'packagingTypeId')::uuid;
    v_quantity := (v_usage ->> 'quantity')::integer;

    select packaging.*
    into v_packaging
    from public.packaging_types packaging
    where packaging.id = v_packaging_id
    for update of packaging;

    if not found then
      raise exception 'PACKAGING_NOT_FOUND' using errcode = 'P0002';
    end if;
    if not v_packaging.active then
      raise exception 'PACKAGING_INACTIVE' using errcode = '23514';
    end if;
    if v_packaging.on_hand_stock - v_packaging.reserved_stock < v_quantity then
      raise exception 'DISPATCH_PACKAGING_INSUFFICIENT:%:%:%',
        v_packaging.name,
        v_packaging.on_hand_stock - v_packaging.reserved_stock,
        v_quantity
        using errcode = '23514';
    end if;

    v_after := v_packaging.on_hand_stock - v_quantity;
    update public.packaging_types packaging
    set on_hand_stock = v_after,
        updated_at = v_now,
        updated_by_id = p_actor_id,
        updated_by_email = btrim(p_actor)
    where packaging.id = v_packaging.id;

    insert into public.packaging_stock_movements (
      operation_id,
      packaging_type_id,
      movement_type,
      on_hand_delta,
      reserved_delta,
      on_hand_before,
      on_hand_after,
      reserved_before,
      reserved_after,
      reason,
      actor_id,
      actor_email,
      created_at
    ) values (
      gen_random_uuid(),
      v_packaging.id,
      'CONSUME',
      -v_quantity,
      0,
      v_packaging.on_hand_stock,
      v_after,
      v_packaging.reserved_stock,
      v_packaging.reserved_stock,
      'Daily dispatch ' || btrim(p_source_filename),
      p_actor_id,
      btrim(p_actor),
      v_now
    );
  end loop;

  insert into public.dispatch_batches (
    operation_id,
    source_sha256,
    source_filename,
    source_generated_at,
    order_ids,
    orders,
    package_usage,
    order_count,
    line_count,
    total_packages,
    actor_id,
    actor_email,
    confirmed_at,
    created_at
  ) values (
    p_operation_id,
    p_source_sha256,
    btrim(p_source_filename),
    nullif(btrim(coalesce(p_source_generated_at, '')), ''),
    v_order_ids,
    p_orders,
    p_package_usage,
    v_order_count,
    v_line_count,
    v_total_packages,
    p_actor_id,
    btrim(p_actor),
    v_now,
    v_now
  ) returning id into v_batch_id;

  v_result := jsonb_build_object(
    'ok', true,
    'batch_id', v_batch_id,
    'operation_id', p_operation_id,
    'order_count', v_order_count,
    'line_count', v_line_count,
    'total_packages', v_total_packages,
    'status', 'CONFIRMED'
  );

  update public.inventory_command_receipts
  set result = v_result
  where operation_id = p_operation_id;

  return v_result;
end;
$$;

create or replace function public.undo_dispatch_batch(
  p_operation_id uuid,
  p_actor_id uuid,
  p_actor text,
  p_batch_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  v_receipt_inserted integer;
  v_existing_command text;
  v_existing_actor uuid;
  v_existing_result jsonb;
  v_batch public.dispatch_batches%rowtype;
  v_usage jsonb;
  v_packaging public.packaging_types%rowtype;
  v_packaging_id uuid;
  v_quantity integer;
  v_after integer;
  v_result jsonb;
  v_now timestamptz := clock_timestamp();
begin
  if p_operation_id is null
    or p_actor_id is null
    or p_batch_id is null
    or nullif(btrim(coalesce(p_actor, '')), '') is null then
    raise exception 'DISPATCH_IDENTITY_REQUIRED' using errcode = '22023';
  end if;

  insert into public.inventory_command_receipts (
    operation_id,
    command_type,
    actor_id
  ) values (
    p_operation_id,
    'dispatch_undo',
    p_actor_id
  )
  on conflict (operation_id) do nothing;

  get diagnostics v_receipt_inserted = row_count;
  if v_receipt_inserted = 0 then
    select receipt.command_type, receipt.actor_id, receipt.result
    into v_existing_command, v_existing_actor, v_existing_result
    from public.inventory_command_receipts receipt
    where receipt.operation_id = p_operation_id;

    if v_existing_command is distinct from 'dispatch_undo'
      or v_existing_actor is distinct from p_actor_id then
      raise exception 'OPERATION_ID_CONFLICT' using errcode = '23505';
    end if;
    if v_existing_result is null then
      raise exception 'OPERATION_RESULT_UNAVAILABLE' using errcode = '40001';
    end if;
    return v_existing_result;
  end if;

  perform pg_advisory_xact_lock(hashtext('stockpro-dispatch-planning'));

  select batch.*
  into v_batch
  from public.dispatch_batches batch
  where batch.id = p_batch_id
  for update of batch;

  if not found then
    raise exception 'DISPATCH_BATCH_NOT_FOUND' using errcode = 'P0002';
  end if;
  if v_batch.status <> 'CONFIRMED' then
    raise exception 'DISPATCH_BATCH_ALREADY_UNDONE' using errcode = '23514';
  end if;

  for v_usage in select value from jsonb_array_elements(v_batch.package_usage)
  loop
    v_packaging_id := (v_usage ->> 'packagingTypeId')::uuid;
    v_quantity := (v_usage ->> 'quantity')::integer;

    select packaging.*
    into v_packaging
    from public.packaging_types packaging
    where packaging.id = v_packaging_id
    for update of packaging;

    if not found then
      raise exception 'PACKAGING_NOT_FOUND' using errcode = 'P0002';
    end if;

    v_after := v_packaging.on_hand_stock + v_quantity;
    update public.packaging_types packaging
    set on_hand_stock = v_after,
        updated_at = v_now,
        updated_by_id = p_actor_id,
        updated_by_email = btrim(p_actor)
    where packaging.id = v_packaging.id;

    insert into public.packaging_stock_movements (
      operation_id,
      packaging_type_id,
      movement_type,
      on_hand_delta,
      reserved_delta,
      on_hand_before,
      on_hand_after,
      reserved_before,
      reserved_after,
      reason,
      actor_id,
      actor_email,
      created_at
    ) values (
      gen_random_uuid(),
      v_packaging.id,
      'UNDO_CONSUME',
      v_quantity,
      0,
      v_packaging.on_hand_stock,
      v_after,
      v_packaging.reserved_stock,
      v_packaging.reserved_stock,
      'Undo daily dispatch ' || v_batch.source_filename,
      p_actor_id,
      btrim(p_actor),
      v_now
    );
  end loop;

  update public.dispatch_batches batch
  set status = 'UNDONE',
      undone_at = v_now,
      undone_by_id = p_actor_id,
      undone_by_email = btrim(p_actor)
  where batch.id = v_batch.id;

  v_result := jsonb_build_object(
    'ok', true,
    'batch_id', v_batch.id,
    'operation_id', p_operation_id,
    'restored_packages', v_batch.total_packages,
    'status', 'UNDONE'
  );

  update public.inventory_command_receipts
  set result = v_result
  where operation_id = p_operation_id;

  return v_result;
end;
$$;

revoke all on function public.confirm_dispatch_batch(
  uuid, uuid, text, text, text, text, jsonb, jsonb
) from public, anon, authenticated;
grant execute on function public.confirm_dispatch_batch(
  uuid, uuid, text, text, text, text, jsonb, jsonb
) to service_role;

revoke all on function public.undo_dispatch_batch(
  uuid, uuid, text, uuid
) from public, anon, authenticated;
grant execute on function public.undo_dispatch_batch(
  uuid, uuid, text, uuid
) to service_role;

commit;
