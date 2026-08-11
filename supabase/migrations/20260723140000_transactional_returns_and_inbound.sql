begin;

create table if not exists public.inventory_command_receipts (
  operation_id uuid primary key,
  command_type text not null,
  actor_id uuid references auth.users(id) on delete set null,
  result jsonb,
  created_at timestamptz not null default now()
);

alter table public.inventory_command_receipts
  drop constraint if exists inventory_command_receipts_actor_id_fkey;
alter table public.inventory_command_receipts
  alter column actor_id drop not null;
alter table public.inventory_command_receipts
  add constraint inventory_command_receipts_actor_id_fkey
  foreign key (actor_id)
  references auth.users(id)
  on delete set null;

create index if not exists inventory_command_receipts_created_at_idx
  on public.inventory_command_receipts (created_at desc);

alter table public.inventory_command_receipts enable row level security;
revoke all on table public.inventory_command_receipts
  from public, anon, authenticated;
grant select, insert, update, delete
  on table public.inventory_command_receipts
  to service_role;

create or replace function public.confirm_return_batch(
  p_operation_id uuid,
  p_actor_id uuid,
  p_actor text,
  p_item_ids uuid[],
  p_target_box text,
  p_target_floor text,
  p_return_ref text,
  p_return_type text,
  p_return_reason text
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
  v_requested_count integer;
  v_found_count integer;
  v_item record;
  v_box_id uuid;
  v_box_inserted integer;
  v_updated integer;
  v_returned integer := 0;
  v_created_boxes integer := 0;
  v_reused_boxes integer := 0;
  v_result jsonb;
  v_now timestamptz := clock_timestamp();
begin
  if p_operation_id is null or p_actor_id is null or nullif(btrim(p_actor), '') is null then
    raise exception 'RETURN_IDENTITY_REQUIRED' using errcode = '22023';
  end if;

  if coalesce(cardinality(p_item_ids), 0) not between 1 and 500 then
    raise exception 'RETURN_ITEM_LIMIT' using errcode = '22023';
  end if;

  if nullif(btrim(p_target_box), '') is null
    or char_length(btrim(p_target_box)) > 200 then
    raise exception 'RETURN_TARGET_BOX_INVALID' using errcode = '22023';
  end if;

  if char_length(coalesce(p_target_floor, '')) > 50
    or nullif(btrim(p_return_type), '') is null
    or char_length(btrim(p_return_type)) > 200
    or nullif(btrim(p_return_reason), '') is null
    or char_length(btrim(p_return_reason)) > 1000
    or char_length(coalesce(p_return_ref, '')) > 500 then
    raise exception 'RETURN_METADATA_INVALID' using errcode = '22023';
  end if;

  insert into public.inventory_command_receipts (
    operation_id,
    command_type,
    actor_id
  )
  values (
    p_operation_id,
    'return',
    p_actor_id
  )
  on conflict (operation_id) do nothing;

  get diagnostics v_receipt_inserted = row_count;

  if v_receipt_inserted = 0 then
    select r.command_type, r.actor_id, r.result
    into v_existing_command, v_existing_actor, v_existing_result
    from public.inventory_command_receipts r
    where r.operation_id = p_operation_id;

    if v_existing_command is distinct from 'return'
      or v_existing_actor is distinct from p_actor_id then
      raise exception 'OPERATION_ID_CONFLICT' using errcode = '23505';
    end if;

    if v_existing_result is null then
      raise exception 'OPERATION_RESULT_UNAVAILABLE' using errcode = '40001';
    end if;

    return v_existing_result;
  end if;

  select count(distinct requested.item_id)
  into v_requested_count
  from unnest(p_item_ids) as requested(item_id);

  perform i.item_id
  from public.items i
  where i.item_id = any(p_item_ids)
  order by i.item_id
  for update of i;

  select count(*)
  into v_found_count
  from public.items i
  where i.item_id = any(p_item_ids);

  if v_found_count <> v_requested_count then
    raise exception 'RETURN_ITEMS_NOT_FOUND' using errcode = 'P0002';
  end if;

  for v_item in
    select i.item_id, i.imei, i.device_id, i.status
    from public.items i
    where i.item_id = any(p_item_ids)
    order by i.item_id
    for update of i
  loop
    if upper(v_item.status) <> 'OUT' then
      continue;
    end if;

    if v_item.device_id is null or nullif(v_item.imei, '') is null then
      raise exception 'RETURN_CANONICAL_ITEM_INVALID' using errcode = '23514';
    end if;

    insert into public.boxes (bin_id, box_code, floor)
    values (
      v_item.device_id,
      btrim(p_target_box),
      nullif(btrim(coalesce(p_target_floor, '')), '')
    )
    on conflict (bin_id, box_code) do nothing;

    get diagnostics v_box_inserted = row_count;

    select b.id
    into v_box_id
    from public.boxes b
    where b.bin_id = v_item.device_id
      and b.box_code = btrim(p_target_box)
    for update;

    if v_box_id is null then
      raise exception 'RETURN_TARGET_BOX_UNAVAILABLE' using errcode = 'P0002';
    end if;

    if nullif(btrim(coalesce(p_target_floor, '')), '') is not null then
      update public.boxes
      set floor = btrim(p_target_floor)
      where id = v_box_id
        and floor is distinct from btrim(p_target_floor);
    end if;

    update public.items
    set status = 'IN',
        box_id = v_box_id
    where item_id = v_item.item_id
      and status = 'OUT';

    get diagnostics v_updated = row_count;

    if v_updated <> 1 then
      raise exception 'RETURN_ITEM_STATE_CHANGED' using errcode = '40001';
    end if;

    insert into public.movements (
      type,
      operation_id,
      item_id,
      box_id,
      device_id,
      imei,
      qty,
      actor,
      actor_id,
      created_by,
      created_at,
      shipment_ref,
      source,
      return_type,
      return_reason,
      notes
    )
    values (
      'RETURN',
      p_operation_id,
      v_item.item_id,
      v_box_id,
      v_item.device_id,
      v_item.imei,
      1,
      btrim(p_actor),
      p_actor_id,
      p_actor_id,
      v_now,
      nullif(btrim(coalesce(p_return_ref, '')), ''),
      'customer_return',
      btrim(p_return_type),
      btrim(p_return_reason),
      btrim(p_return_type) || ' - ' || btrim(p_return_reason)
    );

    v_returned := v_returned + 1;
    if v_box_inserted = 1 then
      v_created_boxes := v_created_boxes + 1;
    else
      v_reused_boxes := v_reused_boxes + 1;
    end if;
  end loop;

  v_result := jsonb_build_object(
    'ok', true,
    'operation_id', p_operation_id,
    'returned', v_returned,
    'created_boxes', v_created_boxes,
    'reused_boxes', v_reused_boxes
  );

  update public.inventory_command_receipts
  set result = v_result
  where operation_id = p_operation_id;

  return v_result;
end;
$$;

create or replace function public.confirm_inbound_batch(
  p_operation_id uuid,
  p_actor_id uuid,
  p_actor text,
  p_vendor text,
  p_source text,
  p_shipment_ref text,
  p_labels jsonb
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
  v_missing_bins text;
  v_imei text;
  v_raw_imei_count integer;
  v_all_imeis integer;
  v_existing_imeis integer;
  v_new_imeis integer;
  v_batch_id uuid;
  v_batch_created_at timestamp;
  v_desired_boxes integer;
  v_created_boxes integer;
  v_reused_boxes integer;
  v_inserted_imeis integer;
  v_result jsonb;
  v_now timestamptz := clock_timestamp();
begin
  if p_operation_id is null or p_actor_id is null or nullif(btrim(p_actor), '') is null then
    raise exception 'INBOUND_IDENTITY_REQUIRED' using errcode = '22023';
  end if;

  if p_source is null or p_source not in ('excel', 'manual') then
    raise exception 'INBOUND_SOURCE_INVALID' using errcode = '22023';
  end if;

  if jsonb_typeof(p_labels) is distinct from 'array' then
    raise exception 'INBOUND_LABEL_LIMIT' using errcode = '22023';
  end if;

  if jsonb_array_length(p_labels) not between 1 and 1000 then
    raise exception 'INBOUND_LABEL_LIMIT' using errcode = '22023';
  end if;

  if char_length(coalesce(p_vendor, '')) > 200
    or char_length(coalesce(p_shipment_ref, '')) > 500 then
    raise exception 'INBOUND_METADATA_INVALID' using errcode = '22023';
  end if;

  if exists (
    select 1
    from jsonb_array_elements(p_labels) as entry(label)
    where jsonb_typeof(entry.label) is distinct from 'object'
      or coalesce(entry.label->>'device_id', '') !~
        '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[1-5][0-9a-fA-F]{3}-[89aAbB][0-9a-fA-F]{3}-[0-9a-fA-F]{12}$'
      or nullif(btrim(entry.label->>'box_no'), '') is null
      or char_length(btrim(entry.label->>'box_no')) > 200
      or char_length(coalesce(entry.label->>'floor', '')) > 50
      or jsonb_typeof(entry.label->'imeis') is distinct from 'array'
      or case
        when jsonb_typeof(entry.label->'imeis') = 'array'
        then jsonb_array_length(entry.label->'imeis') = 0
        else true
      end
  ) then
    raise exception 'INBOUND_LABEL_INVALID' using errcode = '22023';
  end if;

  select sum(jsonb_array_length(entry.label->'imeis'))
  into v_raw_imei_count
  from jsonb_array_elements(p_labels) as entry(label);

  if coalesce(v_raw_imei_count, 0) not between 1 and 50000 then
    raise exception 'INBOUND_IMEI_LIMIT' using errcode = '22023';
  end if;

  if exists (
    select 1
    from jsonb_array_elements(p_labels) as entry(label)
    cross join lateral jsonb_array_elements(entry.label->'imeis') as raw_imei(value)
    where jsonb_typeof(raw_imei.value) is distinct from 'string'
      or (raw_imei.value #>> '{}') !~ '^[0-9]{15}$'
  ) then
    raise exception 'INBOUND_IMEI_INVALID' using errcode = '22023';
  end if;

  with requested_bins as (
    select distinct (entry.label->>'device_id')::uuid as bin_id
    from jsonb_array_elements(p_labels) as entry(label)
  )
  select string_agg(requested.bin_id::text, ', ' order by requested.bin_id::text)
  into v_missing_bins
  from requested_bins requested
  left join public.bins b on b.id = requested.bin_id
  where b.id is null;

  if v_missing_bins is not null then
    raise exception 'INBOUND_BINS_NOT_FOUND:%', v_missing_bins
      using errcode = 'P0002';
  end if;

  insert into public.inventory_command_receipts (
    operation_id,
    command_type,
    actor_id
  )
  values (
    p_operation_id,
    'inbound',
    p_actor_id
  )
  on conflict (operation_id) do nothing;

  get diagnostics v_receipt_inserted = row_count;

  if v_receipt_inserted = 0 then
    select r.command_type, r.actor_id, r.result
    into v_existing_command, v_existing_actor, v_existing_result
    from public.inventory_command_receipts r
    where r.operation_id = p_operation_id;

    if v_existing_command is distinct from 'inbound'
      or v_existing_actor is distinct from p_actor_id then
      raise exception 'OPERATION_ID_CONFLICT' using errcode = '23505';
    end if;

    if v_existing_result is null then
      raise exception 'OPERATION_RESULT_UNAVAILABLE' using errcode = '40001';
    end if;

    return v_existing_result;
  end if;

  for v_imei in
    select distinct raw_imei.value #>> '{}'
    from jsonb_array_elements(p_labels) as entry(label)
    cross join lateral jsonb_array_elements(entry.label->'imeis') as raw_imei(value)
    order by 1
  loop
    perform pg_advisory_xact_lock(hashtextextended(v_imei, 824651));
  end loop;

  with requested_imeis as (
    select distinct raw_imei.value #>> '{}' as imei
    from jsonb_array_elements(p_labels) as entry(label)
    cross join lateral jsonb_array_elements(entry.label->'imeis') as raw_imei(value)
  )
  select count(*),
         count(i.imei)
  into v_all_imeis, v_existing_imeis
  from requested_imeis requested
  left join public.items i on i.imei = requested.imei;

  v_new_imeis := v_all_imeis - v_existing_imeis;

  if v_new_imeis = 0 then
    v_result := jsonb_build_object(
      'ok', false,
      'code', 'ALL_IMEIS_ALREADY_IN_STOCK',
      'error',
        format(
          'Import blocked: all %s %s from this spreadsheet %s already in stock. Nothing was imported and no history was created.',
          v_all_imeis,
          case when v_all_imeis = 1 then 'IMEI' else 'IMEIs' end,
          case when v_all_imeis = 1 then 'is' else 'are' end
        ),
      'totals', jsonb_build_object(
        'inserted_imeis', 0,
        'skipped_existing_imeis', v_existing_imeis,
        'created_boxes', 0,
        'reused_boxes', 0
      )
    );

    update public.inventory_command_receipts
    set result = v_result
    where operation_id = p_operation_id;

    return v_result;
  end if;

  insert into public.inbound_batches (
    actor,
    vendor,
    source,
    shipment_ref
  )
  values (
    btrim(p_actor),
    coalesce(nullif(btrim(p_vendor), ''), 'unknown'),
    p_source,
    nullif(btrim(coalesce(p_shipment_ref, '')), '')
  )
  returning batch_id, created_at
  into v_batch_id, v_batch_created_at;

  with raw_labels as (
    select entry.ordinality as label_order,
           entry.label
    from jsonb_array_elements(p_labels)
      with ordinality as entry(label, ordinality)
  ),
  parsed_labels as (
    select raw.label_order,
           (raw.label->>'device_id')::uuid as bin_id,
           btrim(raw.label->>'box_no') as box_code,
           nullif(btrim(coalesce(raw.label->>'floor', '')), '') as floor,
           raw.label->'imeis' as imeis
    from raw_labels raw
  ),
  parsed_items as (
    select label.label_order,
           raw_imei.ordinality as imei_order,
           label.bin_id,
           label.box_code,
           label.floor,
           raw_imei.value as imei
    from parsed_labels label
    cross join lateral jsonb_array_elements_text(label.imeis)
      with ordinality as raw_imei(value, ordinality)
  ),
  ranked_items as (
    select parsed.*,
           row_number() over (
             partition by parsed.imei
             order by parsed.label_order, parsed.imei_order
           ) as imei_rank
    from parsed_items parsed
  ),
  new_items as (
    select ranked.*
    from ranked_items ranked
    left join public.items existing on existing.imei = ranked.imei
    where ranked.imei_rank = 1
      and existing.imei is null
  ),
  desired_boxes as (
    select distinct on (item.bin_id, item.box_code)
           item.bin_id,
           item.box_code,
           item.floor
    from new_items item
    order by item.bin_id, item.box_code, item.label_order desc
  ),
  inserted_boxes as (
    insert into public.boxes (bin_id, box_code, floor)
    select desired.bin_id, desired.box_code, desired.floor
    from desired_boxes desired
    on conflict (bin_id, box_code) do nothing
    returning id
  )
  select (select count(*) from desired_boxes),
         (select count(*) from inserted_boxes)
  into v_desired_boxes, v_created_boxes;

  v_reused_boxes := v_desired_boxes - v_created_boxes;

  with raw_labels as (
    select entry.ordinality as label_order,
           entry.label
    from jsonb_array_elements(p_labels)
      with ordinality as entry(label, ordinality)
  ),
  parsed_labels as (
    select raw.label_order,
           (raw.label->>'device_id')::uuid as bin_id,
           btrim(raw.label->>'box_no') as box_code,
           nullif(btrim(coalesce(raw.label->>'floor', '')), '') as floor,
           raw.label->'imeis' as imeis
    from raw_labels raw
  ),
  parsed_items as (
    select label.label_order,
           raw_imei.ordinality as imei_order,
           label.bin_id,
           label.box_code,
           label.floor,
           raw_imei.value as imei
    from parsed_labels label
    cross join lateral jsonb_array_elements_text(label.imeis)
      with ordinality as raw_imei(value, ordinality)
  ),
  ranked_items as (
    select parsed.*,
           row_number() over (
             partition by parsed.imei
             order by parsed.label_order, parsed.imei_order
           ) as imei_rank
    from parsed_items parsed
  ),
  new_items as (
    select ranked.*
    from ranked_items ranked
    left join public.items existing on existing.imei = ranked.imei
    where ranked.imei_rank = 1
      and existing.imei is null
  ),
  desired_boxes as (
    select distinct on (item.bin_id, item.box_code)
           item.bin_id,
           item.box_code,
           item.floor
    from new_items item
    order by item.bin_id, item.box_code, item.label_order desc
  )
  update public.boxes box
  set floor = desired.floor
  from desired_boxes desired
  where box.bin_id = desired.bin_id
    and box.box_code = desired.box_code
    and desired.floor is not null
    and box.floor is distinct from desired.floor;

  with raw_labels as (
    select entry.ordinality as label_order,
           entry.label
    from jsonb_array_elements(p_labels)
      with ordinality as entry(label, ordinality)
  ),
  parsed_labels as (
    select raw.label_order,
           (raw.label->>'device_id')::uuid as bin_id,
           btrim(raw.label->>'box_no') as box_code,
           raw.label->'imeis' as imeis
    from raw_labels raw
  ),
  parsed_items as (
    select label.label_order,
           raw_imei.ordinality as imei_order,
           label.bin_id,
           label.box_code,
           raw_imei.value as imei
    from parsed_labels label
    cross join lateral jsonb_array_elements_text(label.imeis)
      with ordinality as raw_imei(value, ordinality)
  ),
  ranked_items as (
    select parsed.*,
           row_number() over (
             partition by parsed.imei
             order by parsed.label_order, parsed.imei_order
           ) as imei_rank
    from parsed_items parsed
  ),
  new_items as (
    select ranked.*
    from ranked_items ranked
    left join public.items existing on existing.imei = ranked.imei
    where ranked.imei_rank = 1
      and existing.imei is null
  ),
  inserted_items as (
    insert into public.items (
      imei,
      box_id,
      device_id,
      status,
      imported_at,
      imported_by,
      import_id
    )
    select item.imei,
           box.id,
           item.bin_id,
           'IN',
           v_now,
           p_actor_id,
           v_batch_id
    from new_items item
    join public.boxes box
      on box.bin_id = item.bin_id
     and box.box_code = item.box_code
    returning item_id, imei, box_id, device_id
  ),
  inserted_movements as (
    insert into public.movements (
      type,
      operation_id,
      batch_id,
      item_id,
      box_id,
      device_id,
      imei,
      qty,
      actor,
      actor_id,
      created_by,
      created_at,
      source,
      shipment_ref,
      notes
    )
    select 'IN',
           p_operation_id,
           v_batch_id,
           item.item_id,
           item.box_id,
           item.device_id,
           item.imei,
           1,
           btrim(p_actor),
           p_actor_id,
           p_actor_id,
           v_now,
           p_source,
           nullif(btrim(coalesce(p_shipment_ref, '')), ''),
           case
             when nullif(btrim(coalesce(p_vendor, '')), '') is not null
             then 'vendor=' || btrim(p_vendor)
             else null
           end
    from inserted_items item
    returning movement_id
  )
  select count(*)
  into v_inserted_imeis
  from inserted_movements;

  if v_inserted_imeis <> v_new_imeis then
    raise exception 'INBOUND_INSERT_COUNT_MISMATCH' using errcode = '40001';
  end if;

  v_result := jsonb_build_object(
    'ok', true,
    'operation_id', p_operation_id,
    'batch_id', v_batch_id,
    'created_at', v_batch_created_at,
    'totals', jsonb_build_object(
      'inserted_imeis', v_inserted_imeis,
      'skipped_existing_imeis', v_existing_imeis,
      'created_boxes', v_created_boxes,
      'reused_boxes', v_reused_boxes
    )
  );

  update public.inventory_command_receipts
  set result = v_result
  where operation_id = p_operation_id;

  return v_result;
end;
$$;

revoke all on function public.confirm_return_batch(
  uuid, uuid, text, uuid[], text, text, text, text, text
) from public, anon, authenticated;
grant execute on function public.confirm_return_batch(
  uuid, uuid, text, uuid[], text, text, text, text, text
) to service_role;

revoke all on function public.confirm_inbound_batch(
  uuid, uuid, text, text, text, text, jsonb
) from public, anon, authenticated;
grant execute on function public.confirm_inbound_batch(
  uuid, uuid, text, text, text, text, jsonb
) to service_role;

comment on function public.confirm_return_batch(
  uuid, uuid, text, uuid[], text, text, text, text, text
) is
  'Atomically returns canonical OUT items to boxes and records RETURN movements.';

comment on function public.confirm_inbound_batch(
  uuid, uuid, text, text, text, text, jsonb
) is
  'Atomically claims inbound IMEIs, creates stock and records IN movements.';

commit;
