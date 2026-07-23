begin;

create or replace function public.confirm_accessory_outbound(
  p_operation_id uuid,
  p_actor_id uuid,
  p_actor text,
  p_source text,
  p_shipment_ref text,
  p_note text,
  p_lines jsonb
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
  v_bad_name text;
  v_bad_stock integer;
  v_bad_qty integer;
  v_bin record;
  v_after_stock integer;
  v_removed jsonb := '[]'::jsonb;
  v_result jsonb;
begin
  if p_operation_id is null
    or p_actor_id is null
    or nullif(btrim(p_actor), '') is null then
    raise exception 'ACCESSORY_IDENTITY_REQUIRED' using errcode = '22023';
  end if;

  if p_source not in ('manual', 'excel')
    or char_length(coalesce(p_shipment_ref, '')) > 500
    or char_length(coalesce(p_note, '')) > 1000 then
    raise exception 'ACCESSORY_METADATA_INVALID' using errcode = '22023';
  end if;

  if jsonb_typeof(p_lines) is distinct from 'array'
    or jsonb_array_length(p_lines) not between 1 and 500 then
    raise exception 'ACCESSORY_LINE_LIMIT' using errcode = '22023';
  end if;

  if exists (
    select 1
    from jsonb_array_elements(p_lines) as entry(line)
    where jsonb_typeof(entry.line) is distinct from 'object'
      or coalesce(entry.line->>'accessory_bin_id', '') !~
        '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[1-5][0-9a-fA-F]{3}-[89aAbB][0-9a-fA-F]{3}-[0-9a-fA-F]{12}$'
      or coalesce(entry.line->>'qty', '') !~ '^[1-9][0-9]{0,6}$'
  ) then
    raise exception 'ACCESSORY_LINE_INVALID' using errcode = '22023';
  end if;

  insert into public.inventory_command_receipts (
    operation_id,
    command_type,
    actor_id
  )
  values (
    p_operation_id,
    'accessory_outbound',
    p_actor_id
  )
  on conflict (operation_id) do nothing;

  get diagnostics v_receipt_inserted = row_count;

  if v_receipt_inserted = 0 then
    select receipt.command_type, receipt.actor_id, receipt.result
    into v_existing_command, v_existing_actor, v_existing_result
    from public.inventory_command_receipts receipt
    where receipt.operation_id = p_operation_id;

    if v_existing_command is distinct from 'accessory_outbound'
      or v_existing_actor is distinct from p_actor_id then
      raise exception 'OPERATION_ID_CONFLICT' using errcode = '23505';
    end if;

    if v_existing_result is null then
      raise exception 'OPERATION_RESULT_UNAVAILABLE' using errcode = '40001';
    end if;

    return v_existing_result;
  end if;

  with requested as (
    select (entry.line->>'accessory_bin_id')::uuid as accessory_bin_id,
           sum((entry.line->>'qty')::integer)::integer as qty
    from jsonb_array_elements(p_lines) as entry(line)
    group by (entry.line->>'accessory_bin_id')::uuid
  )
  select count(*)
  into v_requested_count
  from requested;

  perform bin.id
  from public.accessory_bins bin
  join (
    select (entry.line->>'accessory_bin_id')::uuid as accessory_bin_id
    from jsonb_array_elements(p_lines) as entry(line)
    group by (entry.line->>'accessory_bin_id')::uuid
  ) requested on requested.accessory_bin_id = bin.id
  order by bin.id
  for update of bin;

  with requested as (
    select (entry.line->>'accessory_bin_id')::uuid as accessory_bin_id
    from jsonb_array_elements(p_lines) as entry(line)
    group by (entry.line->>'accessory_bin_id')::uuid
  )
  select count(*)
  into v_found_count
  from requested
  join public.accessory_bins bin on bin.id = requested.accessory_bin_id
  where bin.active;

  if v_found_count <> v_requested_count then
    raise exception 'ACCESSORY_BINS_NOT_FOUND' using errcode = 'P0002';
  end if;

  with requested as (
    select (entry.line->>'accessory_bin_id')::uuid as accessory_bin_id,
           sum((entry.line->>'qty')::integer)::integer as qty
    from jsonb_array_elements(p_lines) as entry(line)
    group by (entry.line->>'accessory_bin_id')::uuid
  )
  select bin.name, bin.current_stock, requested.qty
  into v_bad_name, v_bad_stock, v_bad_qty
  from requested
  join public.accessory_bins bin on bin.id = requested.accessory_bin_id
  where bin.current_stock < requested.qty
  order by bin.id
  limit 1;

  if v_bad_name is not null then
    raise exception 'ACCESSORY_STOCK_INSUFFICIENT:%:%:%',
      v_bad_name, v_bad_stock, v_bad_qty
      using errcode = '23514';
  end if;

  for v_bin in
    with requested as (
      select (entry.line->>'accessory_bin_id')::uuid as accessory_bin_id,
             sum((entry.line->>'qty')::integer)::integer as qty
      from jsonb_array_elements(p_lines) as entry(line)
      group by (entry.line->>'accessory_bin_id')::uuid
    )
    select bin.id, bin.name, bin.current_stock, requested.qty
    from requested
    join public.accessory_bins bin on bin.id = requested.accessory_bin_id
    order by bin.id
  loop
    update public.accessory_bins as bin
    set current_stock = bin.current_stock - v_bin.qty
    where bin.id = v_bin.id
      and bin.current_stock >= v_bin.qty
    returning current_stock into v_after_stock;

    if not found then
      raise exception 'ACCESSORY_STOCK_CHANGED' using errcode = '40001';
    end if;

    insert into public.accessory_movements (
      accessory_bin_id,
      qty,
      movement_type,
      shipment_ref,
      note,
      actor,
      actor_id,
      source,
      operation_id
    )
    values (
      v_bin.id,
      v_bin.qty,
      'OUT',
      nullif(btrim(coalesce(p_shipment_ref, '')), ''),
      nullif(btrim(coalesce(p_note, '')), ''),
      btrim(p_actor),
      p_actor_id,
      p_source,
      p_operation_id
    );

    v_removed := v_removed || jsonb_build_array(
      jsonb_build_object(
        'accessory_bin_id', v_bin.id,
        'accessory', v_bin.name,
        'qty', v_bin.qty,
        'current_stock', v_bin.current_stock,
        'after_stock', v_after_stock
      )
    );
  end loop;

  v_result := jsonb_build_object(
    'ok', true,
    'operation_id', p_operation_id,
    'removed', v_removed,
    'rows', v_removed
  );

  update public.inventory_command_receipts
  set result = v_result
  where operation_id = p_operation_id;

  return v_result;
end;
$$;

create or replace function public.confirm_transfer_batch(
  p_operation_id uuid,
  p_actor_id uuid,
  p_actor text,
  p_source_bin_id uuid,
  p_target_floor text,
  p_box_codes text[]
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
  v_box record;
  v_moved integer := 0;
  v_result jsonb;
  v_now timestamptz := clock_timestamp();
begin
  if p_operation_id is null
    or p_actor_id is null
    or nullif(btrim(p_actor), '') is null then
    raise exception 'TRANSFER_IDENTITY_REQUIRED' using errcode = '22023';
  end if;

  if p_source_bin_id is null
    or nullif(btrim(p_target_floor), '') is null
    or char_length(btrim(p_target_floor)) > 50
    or coalesce(cardinality(p_box_codes), 0) not between 1 and 500
    or exists (
      select 1
      from unnest(p_box_codes) as requested(box_code)
      where nullif(btrim(requested.box_code), '') is null
        or char_length(btrim(requested.box_code)) > 200
    ) then
    raise exception 'TRANSFER_REQUEST_INVALID' using errcode = '22023';
  end if;

  insert into public.inventory_command_receipts (
    operation_id,
    command_type,
    actor_id
  )
  values (
    p_operation_id,
    'transfer',
    p_actor_id
  )
  on conflict (operation_id) do nothing;

  get diagnostics v_receipt_inserted = row_count;

  if v_receipt_inserted = 0 then
    select receipt.command_type, receipt.actor_id, receipt.result
    into v_existing_command, v_existing_actor, v_existing_result
    from public.inventory_command_receipts receipt
    where receipt.operation_id = p_operation_id;

    if v_existing_command is distinct from 'transfer'
      or v_existing_actor is distinct from p_actor_id then
      raise exception 'OPERATION_ID_CONFLICT' using errcode = '23505';
    end if;

    if v_existing_result is null then
      raise exception 'OPERATION_RESULT_UNAVAILABLE' using errcode = '40001';
    end if;

    return v_existing_result;
  end if;

  select count(distinct btrim(requested.box_code))
  into v_requested_count
  from unnest(p_box_codes) as requested(box_code);

  perform box.id
  from public.boxes box
  where box.bin_id = p_source_bin_id
    and box.box_code in (
      select distinct btrim(requested.box_code)
      from unnest(p_box_codes) as requested(box_code)
    )
  order by box.id
  for update of box;

  select count(*)
  into v_found_count
  from public.boxes box
  where box.bin_id = p_source_bin_id
    and box.box_code in (
      select distinct btrim(requested.box_code)
      from unnest(p_box_codes) as requested(box_code)
    );

  if v_found_count <> v_requested_count then
    raise exception 'TRANSFER_BOXES_NOT_FOUND' using errcode = 'P0002';
  end if;

  if exists (
    select 1
    from public.boxes box
    where box.bin_id = p_source_bin_id
      and box.box_code in (
        select distinct btrim(requested.box_code)
        from unnest(p_box_codes) as requested(box_code)
      )
      and box.floor = btrim(p_target_floor)
  ) then
    raise exception 'TRANSFER_ALREADY_ON_FLOOR' using errcode = '23514';
  end if;

  if exists (
    select 1
    from public.boxes box
    where box.bin_id = p_source_bin_id
      and box.box_code in (
        select distinct btrim(requested.box_code)
        from unnest(p_box_codes) as requested(box_code)
      )
      and not exists (
        select 1
        from public.items item
        where item.box_id = box.id
          and item.status = 'IN'
      )
  ) then
    raise exception 'TRANSFER_EMPTY_BOX' using errcode = '23514';
  end if;

  for v_box in
    select box.id, box.box_code, box.bin_id, box.floor
    from public.boxes box
    where box.bin_id = p_source_bin_id
      and box.box_code in (
        select distinct btrim(requested.box_code)
        from unnest(p_box_codes) as requested(box_code)
      )
    order by box.id
  loop
    update public.boxes
    set floor = btrim(p_target_floor)
    where id = v_box.id;

    insert into public.movements (
      type,
      operation_id,
      device_id,
      box_id,
      qty,
      actor,
      actor_id,
      created_by,
      from_floor,
      to_floor,
      created_at
    )
    values (
      'TRANSFER',
      p_operation_id,
      v_box.bin_id,
      v_box.id,
      1,
      btrim(p_actor),
      p_actor_id,
      p_actor_id,
      v_box.floor,
      btrim(p_target_floor),
      v_now
    );

    v_moved := v_moved + 1;
  end loop;

  v_result := jsonb_build_object(
    'ok', true,
    'operation_id', p_operation_id,
    'moved_boxes', v_moved
  );

  update public.inventory_command_receipts
  set result = v_result
  where operation_id = p_operation_id;

  return v_result;
end;
$$;

create or replace function public.confirm_outbound_batch(
  p_imeis text[],
  p_actor text,
  p_actor_id uuid,
  p_shipment_ref text,
  p_source text,
  p_operation_id uuid
)
returns json
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
  v_inserted integer;
  v_updated integer;
  v_result jsonb;
  v_imei text;
  v_now timestamptz := clock_timestamp();
begin
  if p_operation_id is null
    or p_actor_id is null
    or nullif(btrim(p_actor), '') is null then
    raise exception 'OUTBOUND_IDENTITY_REQUIRED' using errcode = '22023';
  end if;

  if coalesce(cardinality(p_imeis), 0) not between 1 and 50000
    or p_source not in ('manual', 'excel')
    or char_length(coalesce(p_shipment_ref, '')) > 500
    or exists (
      select 1
      from unnest(p_imeis) as requested(imei)
      where requested.imei !~ '^[0-9]{15}$'
    ) then
    raise exception 'OUTBOUND_REQUEST_INVALID' using errcode = '22023';
  end if;

  insert into public.inventory_command_receipts (
    operation_id,
    command_type,
    actor_id
  )
  values (
    p_operation_id,
    'outbound',
    p_actor_id
  )
  on conflict (operation_id) do nothing;

  get diagnostics v_receipt_inserted = row_count;

  if v_receipt_inserted = 0 then
    select receipt.command_type, receipt.actor_id, receipt.result
    into v_existing_command, v_existing_actor, v_existing_result
    from public.inventory_command_receipts receipt
    where receipt.operation_id = p_operation_id;

    if v_existing_command is distinct from 'outbound'
      or v_existing_actor is distinct from p_actor_id then
      raise exception 'OPERATION_ID_CONFLICT' using errcode = '23505';
    end if;

    if v_existing_result is null then
      raise exception 'OPERATION_RESULT_UNAVAILABLE' using errcode = '40001';
    end if;

    return v_existing_result::json;
  end if;

  select count(distinct requested.imei)
  into v_requested_count
  from unnest(p_imeis) as requested(imei);

  for v_imei in
    select distinct requested.imei
    from unnest(p_imeis) as requested(imei)
    order by requested.imei
  loop
    perform pg_advisory_xact_lock(hashtextextended(v_imei, 735642));
  end loop;

  perform item.item_id
  from public.items item
  where item.imei = any(p_imeis)
  order by item.item_id
  for update of item;

  select count(*)
  into v_found_count
  from public.items item
  where item.imei = any(p_imeis);

  if v_found_count <> v_requested_count then
    raise exception 'OUTBOUND_IMEIS_NOT_FOUND' using errcode = 'P0002';
  end if;

  if exists (
    select 1
    from public.items item
    where item.imei = any(p_imeis)
      and item.status <> 'IN'
  ) then
    raise exception 'OUTBOUND_IMEI_NOT_IN_STOCK' using errcode = '23514';
  end if;

  insert into public.movements (
    type,
    imei,
    item_id,
    device_id,
    box_id,
    operation_id,
    actor,
    actor_id,
    source,
    shipment_ref,
    created_by,
    created_at,
    qty
  )
  select
    'OUT',
    item.imei,
    item.item_id,
    item.device_id,
    item.box_id,
    p_operation_id,
    btrim(p_actor),
    p_actor_id,
    p_source,
    nullif(btrim(coalesce(p_shipment_ref, '')), ''),
    p_actor_id,
    v_now,
    1
  from public.items item
  where item.imei = any(p_imeis)
  order by item.item_id;

  get diagnostics v_inserted = row_count;

  if v_inserted <> v_requested_count then
    raise exception 'OUTBOUND_MOVEMENT_COUNT_MISMATCH' using errcode = '40001';
  end if;

  update public.items item
  set status = 'OUT',
      shipped_at = v_now,
      shipment_ref = nullif(btrim(coalesce(p_shipment_ref, '')), '')
  where item.imei = any(p_imeis)
    and item.status = 'IN';

  get diagnostics v_updated = row_count;

  if v_updated <> v_requested_count then
    raise exception 'OUTBOUND_ITEM_STATE_CHANGED' using errcode = '40001';
  end if;

  v_result := jsonb_build_object(
    'ok', true,
    'operation_id', p_operation_id,
    'count', v_updated
  );

  update public.inventory_command_receipts
  set result = v_result
  where operation_id = p_operation_id;

  return v_result::json;
end;
$$;

create or replace function public.create_supply_order(
  p_operation_id uuid,
  p_actor_id uuid,
  p_actor text,
  p_order_number text,
  p_from_office text,
  p_to_office text,
  p_comment text,
  p_items jsonb
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
  v_supply public.supplies%rowtype;
  v_result jsonb;
begin
  if p_operation_id is null
    or p_actor_id is null
    or nullif(btrim(p_actor), '') is null then
    raise exception 'SUPPLY_IDENTITY_REQUIRED' using errcode = '22023';
  end if;

  if nullif(btrim(p_order_number), '') is null
    or char_length(btrim(p_order_number)) > 100
    or coalesce(p_from_office, '') !~ '^[A-Z]{2}$'
    or coalesce(p_to_office, '') !~ '^[A-Z]{2}$'
    or p_from_office = p_to_office
    or char_length(coalesce(p_comment, '')) > 2000
    or jsonb_typeof(p_items) is distinct from 'array'
    or jsonb_array_length(p_items) not between 1 and 500 then
    raise exception 'SUPPLY_CREATE_INVALID' using errcode = '22023';
  end if;

  if exists (
    select 1
    from jsonb_array_elements(p_items) as entry(item)
    where jsonb_typeof(entry.item) is distinct from 'object'
      or upper(coalesce(entry.item->>'product_type', '')) not in ('DEVICE', 'ACCESSORY')
      or nullif(btrim(entry.item->>'product_name'), '') is null
      or char_length(btrim(entry.item->>'product_name')) > 200
      or coalesce(entry.item->>'qty', '') !~ '^[1-9][0-9]{0,6}$'
      or (
        nullif(entry.item->>'product_id', '') is not null
        and (entry.item->>'product_id') !~
          '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[1-5][0-9a-fA-F]{3}-[89aAbB][0-9a-fA-F]{3}-[0-9a-fA-F]{12}$'
      )
  ) then
    raise exception 'SUPPLY_ITEM_INVALID' using errcode = '22023';
  end if;

  insert into public.inventory_command_receipts (
    operation_id,
    command_type,
    actor_id
  )
  values (
    p_operation_id,
    'supply_create',
    p_actor_id
  )
  on conflict (operation_id) do nothing;

  get diagnostics v_receipt_inserted = row_count;

  if v_receipt_inserted = 0 then
    select receipt.command_type, receipt.actor_id, receipt.result
    into v_existing_command, v_existing_actor, v_existing_result
    from public.inventory_command_receipts receipt
    where receipt.operation_id = p_operation_id;

    if v_existing_command is distinct from 'supply_create'
      or v_existing_actor is distinct from p_actor_id then
      raise exception 'OPERATION_ID_CONFLICT' using errcode = '23505';
    end if;

    if v_existing_result is null then
      raise exception 'OPERATION_RESULT_UNAVAILABLE' using errcode = '40001';
    end if;

    return v_existing_result;
  end if;

  insert into public.supplies (
    order_number,
    from_office,
    to_office,
    tracking_number,
    status,
    imported,
    imported_date,
    comment,
    created_by,
    created_by_id
  )
  values (
    btrim(p_order_number),
    p_from_office,
    p_to_office,
    null,
    'CREATED',
    false,
    null,
    nullif(btrim(coalesce(p_comment, '')), ''),
    btrim(p_actor),
    p_actor_id
  )
  returning * into v_supply;

  insert into public.supply_status_history (
    supply_id,
    status,
    tracking_number,
    changed_by,
    changed_by_id
  )
  values (
    v_supply.id,
    'CREATED',
    null,
    btrim(p_actor),
    p_actor_id
  );

  insert into public.supply_items (
    supply_id,
    product_id,
    product_type,
    product_name,
    qty
  )
  select
    v_supply.id,
    nullif(entry.item->>'product_id', '')::uuid,
    upper(entry.item->>'product_type'),
    btrim(entry.item->>'product_name'),
    (entry.item->>'qty')::integer
  from jsonb_array_elements(p_items) as entry(item);

  v_result := jsonb_build_object(
    'ok', true,
    'operation_id', p_operation_id,
    'supply', to_jsonb(v_supply)
  );

  update public.inventory_command_receipts
  set result = v_result
  where operation_id = p_operation_id;

  return v_result;
end;
$$;

create or replace function public.transition_supply_order(
  p_operation_id uuid,
  p_actor_id uuid,
  p_actor text,
  p_supply_id uuid,
  p_status text,
  p_tracking_number text,
  p_failed_reason text
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
  v_supply public.supplies%rowtype;
  v_updated public.supplies%rowtype;
  v_history public.supply_status_history%rowtype;
  v_status text := upper(btrim(coalesce(p_status, '')));
  v_now timestamptz := clock_timestamp();
  v_result jsonb;
begin
  if p_operation_id is null
    or p_actor_id is null
    or nullif(btrim(p_actor), '') is null
    or p_supply_id is null then
    raise exception 'SUPPLY_IDENTITY_REQUIRED' using errcode = '22023';
  end if;

  if v_status not in ('CREATED', 'SHIPPED', 'RECEIVED', 'IMPORTED', 'FAILED')
    or char_length(coalesce(p_tracking_number, '')) > 500
    or char_length(coalesce(p_failed_reason, '')) > 1000
    or (
      v_status = 'FAILED'
      and nullif(btrim(coalesce(p_failed_reason, '')), '') is null
    ) then
    raise exception 'SUPPLY_TRANSITION_INVALID' using errcode = '22023';
  end if;

  insert into public.inventory_command_receipts (
    operation_id,
    command_type,
    actor_id
  )
  values (
    p_operation_id,
    'supply_transition',
    p_actor_id
  )
  on conflict (operation_id) do nothing;

  get diagnostics v_receipt_inserted = row_count;

  if v_receipt_inserted = 0 then
    select receipt.command_type, receipt.actor_id, receipt.result
    into v_existing_command, v_existing_actor, v_existing_result
    from public.inventory_command_receipts receipt
    where receipt.operation_id = p_operation_id;

    if v_existing_command is distinct from 'supply_transition'
      or v_existing_actor is distinct from p_actor_id then
      raise exception 'OPERATION_ID_CONFLICT' using errcode = '23505';
    end if;

    if v_existing_result is null then
      raise exception 'OPERATION_RESULT_UNAVAILABLE' using errcode = '40001';
    end if;

    return v_existing_result;
  end if;

  select supply.*
  into v_supply
  from public.supplies supply
  where supply.id = p_supply_id
  for update of supply;

  if not found then
    raise exception 'SUPPLY_NOT_FOUND' using errcode = 'P0002';
  end if;

  if lower(v_supply.status) in ('imported', 'failed') then
    raise exception 'SUPPLY_TERMINAL_LOCKED' using errcode = '23514';
  end if;

  if not (
    (v_supply.status = 'CREATED' and v_status in ('CREATED', 'SHIPPED', 'FAILED'))
    or (v_supply.status = 'SHIPPED' and v_status in ('SHIPPED', 'RECEIVED', 'FAILED'))
    or (v_supply.status = 'RECEIVED' and v_status in ('RECEIVED', 'IMPORTED', 'FAILED'))
  ) then
    raise exception 'SUPPLY_STATUS_TRANSITION_INVALID' using errcode = '23514';
  end if;

  update public.supplies
  set status = v_status,
      tracking_number = nullif(btrim(coalesce(p_tracking_number, '')), ''),
      failed_reason = case
        when v_status = 'FAILED'
        then btrim(p_failed_reason)
        else null
      end,
      imported = (v_status = 'IMPORTED'),
      imported_date = case
        when v_status = 'IMPORTED' then v_now
        else null
      end,
      updated_at = v_now
  where id = p_supply_id
  returning * into v_updated;

  insert into public.supply_status_history (
    supply_id,
    status,
    tracking_number,
    failed_reason,
    changed_by,
    changed_by_id
  )
  values (
    p_supply_id,
    v_status,
    nullif(btrim(coalesce(p_tracking_number, '')), ''),
    case
      when v_status = 'FAILED'
      then btrim(p_failed_reason)
      else null
    end,
    btrim(p_actor),
    p_actor_id
  )
  returning * into v_history;

  v_result := jsonb_build_object(
    'ok', true,
    'operation_id', p_operation_id,
    'row', to_jsonb(v_updated),
    'historyRow', to_jsonb(v_history)
  );

  update public.inventory_command_receipts
  set result = v_result
  where operation_id = p_operation_id;

  return v_result;
end;
$$;

create or replace function public.delete_supply_order(
  p_operation_id uuid,
  p_actor_id uuid,
  p_supply_id uuid
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
  v_supply public.supplies%rowtype;
  v_result jsonb;
begin
  if p_operation_id is null
    or p_actor_id is null
    or p_supply_id is null then
    raise exception 'SUPPLY_IDENTITY_REQUIRED' using errcode = '22023';
  end if;

  insert into public.inventory_command_receipts (
    operation_id,
    command_type,
    actor_id
  )
  values (
    p_operation_id,
    'supply_delete',
    p_actor_id
  )
  on conflict (operation_id) do nothing;

  get diagnostics v_receipt_inserted = row_count;

  if v_receipt_inserted = 0 then
    select receipt.command_type, receipt.actor_id, receipt.result
    into v_existing_command, v_existing_actor, v_existing_result
    from public.inventory_command_receipts receipt
    where receipt.operation_id = p_operation_id;

    if v_existing_command is distinct from 'supply_delete'
      or v_existing_actor is distinct from p_actor_id then
      raise exception 'OPERATION_ID_CONFLICT' using errcode = '23505';
    end if;

    if v_existing_result is null then
      raise exception 'OPERATION_RESULT_UNAVAILABLE' using errcode = '40001';
    end if;

    return v_existing_result;
  end if;

  select supply.*
  into v_supply
  from public.supplies supply
  where supply.id = p_supply_id
  for update of supply;

  if not found then
    raise exception 'SUPPLY_NOT_FOUND' using errcode = 'P0002';
  end if;

  if lower(v_supply.status) in ('imported', 'failed') then
    raise exception 'SUPPLY_TERMINAL_LOCKED' using errcode = '23514';
  end if;

  delete from public.supplies
  where id = p_supply_id;

  v_result := jsonb_build_object(
    'ok', true,
    'operation_id', p_operation_id,
    'deleted_order_number', v_supply.order_number
  );

  update public.inventory_command_receipts
  set result = v_result
  where operation_id = p_operation_id;

  return v_result;
end;
$$;

revoke all on function public.confirm_accessory_outbound(
  uuid, uuid, text, text, text, text, jsonb
) from public, anon, authenticated;
grant execute on function public.confirm_accessory_outbound(
  uuid, uuid, text, text, text, text, jsonb
) to service_role;

revoke all on function public.confirm_transfer_batch(
  uuid, uuid, text, uuid, text, text[]
) from public, anon, authenticated;
grant execute on function public.confirm_transfer_batch(
  uuid, uuid, text, uuid, text, text[]
) to service_role;

revoke all on function public.confirm_outbound_batch(
  text[], text, uuid, text, text, uuid
) from public, anon, authenticated;
grant execute on function public.confirm_outbound_batch(
  text[], text, uuid, text, text, uuid
) to service_role;

revoke all on function public.create_supply_order(
  uuid, uuid, text, text, text, text, text, jsonb
) from public, anon, authenticated;
grant execute on function public.create_supply_order(
  uuid, uuid, text, text, text, text, text, jsonb
) to service_role;

revoke all on function public.transition_supply_order(
  uuid, uuid, text, uuid, text, text, text
) from public, anon, authenticated;
grant execute on function public.transition_supply_order(
  uuid, uuid, text, uuid, text, text, text
) to service_role;

revoke all on function public.delete_supply_order(
  uuid, uuid, uuid
) from public, anon, authenticated;
grant execute on function public.delete_supply_order(
  uuid, uuid, uuid
) to service_role;

commit;
