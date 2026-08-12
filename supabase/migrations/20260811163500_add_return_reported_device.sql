begin;

alter table public.return_records
  add column if not exists reported_device text;

alter table public.return_records
  drop constraint if exists return_records_return_status_check;

alter table public.return_records
  add constraint return_records_return_status_check
  check (
    return_status in ('available', 'damaged', 'disposed', 'returned_unprocessed')
  );

update public.return_records r
set reported_device = b.name
from public.bins b
where b.id = r.device_id
  and nullif(btrim(coalesce(r.reported_device, '')), '') is null;

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'return_records_reported_device_length_check'
      and conrelid = 'public.return_records'::regclass
  ) then
    alter table public.return_records
      add constraint return_records_reported_device_length_check
      check (
        reported_device is null
        or char_length(btrim(reported_device)) between 1 and 200
      );
  end if;
end;
$$;

create or replace function public.confirm_return_batch(
  p_operation_id uuid,
  p_actor_id uuid,
  p_actor text,
  p_item_ids uuid[],
  p_target_box text,
  p_target_floor text,
  p_return_ref text,
  p_return_type text,
  p_return_reason text,
  p_return_status text,
  p_courier text,
  p_country_code text,
  p_customer text,
  p_sur_id text,
  p_reported_device text
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
  v_target_box_id uuid;
  v_movement_box_id uuid;
  v_movement_id uuid;
  v_box_inserted integer;
  v_updated integer;
  v_recorded integer := 0;
  v_added_to_stock integer := 0;
  v_logged_only integer := 0;
  v_created_boxes integer := 0;
  v_reused_boxes integer := 0;
  v_result jsonb;
  v_now timestamptz := clock_timestamp();
  v_status text := lower(btrim(coalesce(p_return_status, '')));
  v_courier text := upper(btrim(coalesce(p_courier, '')));
  v_country_code text := upper(btrim(coalesce(p_country_code, '')));
  v_requested_device text := nullif(btrim(coalesce(p_reported_device, '')), '');
  v_reported_device text;
  v_record_device text;
begin
  if p_operation_id is null
    or p_actor_id is null
    or nullif(btrim(p_actor), '') is null then
    raise exception 'RETURN_IDENTITY_REQUIRED' using errcode = '22023';
  end if;

  if coalesce(cardinality(p_item_ids), 0) not between 1 and 500 then
    raise exception 'RETURN_ITEM_LIMIT' using errcode = '22023';
  end if;

  if v_status not in ('available', 'damaged', 'disposed', 'returned_unprocessed')
    or v_courier not in ('DHL', 'EASYPOST')
    or v_country_code not in ('BE', 'UK', 'NL', 'DE', 'FR', 'ES', 'IE', 'PT', 'IT')
    or nullif(btrim(p_return_ref), '') is null
    or char_length(btrim(p_return_ref)) > 200
    or nullif(btrim(p_customer), '') is null
    or char_length(btrim(p_customer)) > 300
    or nullif(btrim(p_sur_id), '') is null
    or char_length(btrim(p_sur_id)) > 200
    or nullif(btrim(coalesce(p_return_type, '')), '') is null
    or btrim(p_return_type) not in ('cancellation_stop', 'technical_stop')
    or nullif(btrim(p_return_reason), '') is null
    or char_length(btrim(p_return_reason)) > 1000 then
    raise exception 'RETURN_METADATA_INVALID' using errcode = '22023';
  end if;

  if v_status = 'available' and (
    nullif(btrim(coalesce(p_target_box, '')), '') is null
    or char_length(btrim(p_target_box)) > 200
    or btrim(coalesce(p_target_floor, '')) not in ('00', '1', '6', 'Cabinet')
  ) then
    raise exception 'RETURN_TARGET_BOX_INVALID' using errcode = '22023';
  end if;

  if v_status <> 'available' then
    if v_requested_device is null or char_length(v_requested_device) > 200 then
      raise exception 'RETURN_DEVICE_INVALID' using errcode = '22023';
    end if;

    select b.name
    into v_reported_device
    from public.bins b
    where lower(btrim(b.name)) = lower(v_requested_device)
    order by b.active desc, b.name
    limit 1;

    if v_reported_device is null then
      v_reported_device := case upper(v_requested_device)
        when 'LMU2640' then 'LMU2640'
        when 'FMT100' then 'FMT100'
        when 'FMB020' then 'FMB020'
        when 'FMB003' then 'FMB003'
        when 'FMB920' then 'FMB920'
        when 'FMB130' then 'FMB130'
        when 'GL50B' then 'GL50B'
        when 'FMB640' then 'FMB640'
        when 'FMB641' then 'FMB641'
        when 'FMB204' then 'FMB204'
        when 'BADAI' then 'Badai'
        else null
      end;
    end if;

    if v_reported_device is null then
      raise exception 'RETURN_DEVICE_INVALID' using errcode = '22023';
    end if;
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
    select
      i.item_id,
      i.imei,
      i.device_id,
      i.status,
      i.box_id,
      coalesce(previous_box.box_code, '') as previous_box,
      coalesce(previous_box.floor, '') as previous_floor,
      coalesce(canonical_bin.name, '') as canonical_device
    from public.items i
    left join public.boxes previous_box on previous_box.id = i.box_id
    left join public.bins canonical_bin on canonical_bin.id = i.device_id
    where i.item_id = any(p_item_ids)
    order by i.item_id
    for update of i
  loop
    if upper(v_item.status) <> 'OUT' then
      raise exception 'RETURN_ITEM_STATE_CHANGED' using errcode = '40001';
    end if;

    if v_item.device_id is null
      or nullif(v_item.imei, '') is null
      or nullif(v_item.canonical_device, '') is null then
      raise exception 'RETURN_CANONICAL_ITEM_INVALID' using errcode = '23514';
    end if;

    v_record_device := case
      when v_status = 'available' then v_item.canonical_device
      else v_reported_device
    end;
    v_target_box_id := null;
    v_box_inserted := 0;

    if v_status = 'available' then
      insert into public.boxes (bin_id, box_code, floor)
      values (
        v_item.device_id,
        btrim(p_target_box),
        btrim(p_target_floor)
      )
      on conflict (bin_id, box_code) do nothing;

      get diagnostics v_box_inserted = row_count;

      select b.id
      into v_target_box_id
      from public.boxes b
      where b.bin_id = v_item.device_id
        and b.box_code = btrim(p_target_box)
      for update;

      if v_target_box_id is null then
        raise exception 'RETURN_TARGET_BOX_UNAVAILABLE' using errcode = 'P0002';
      end if;

      update public.boxes
      set floor = btrim(p_target_floor)
      where id = v_target_box_id
        and floor is distinct from btrim(p_target_floor);

      update public.items
      set status = 'IN',
          box_id = v_target_box_id
      where item_id = v_item.item_id
        and status = 'OUT';

      get diagnostics v_updated = row_count;

      if v_updated <> 1 then
        raise exception 'RETURN_ITEM_STATE_CHANGED' using errcode = '40001';
      end if;

      v_movement_box_id := v_target_box_id;
      v_added_to_stock := v_added_to_stock + 1;
      if v_box_inserted = 1 then
        v_created_boxes := v_created_boxes + 1;
      else
        v_reused_boxes := v_reused_boxes + 1;
      end if;
    else
      v_movement_box_id := v_item.box_id;
      v_logged_only := v_logged_only + 1;
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
      v_movement_box_id,
      v_item.device_id,
      v_item.imei,
      1,
      btrim(p_actor),
      p_actor_id,
      p_actor_id,
      v_now,
      btrim(p_return_ref),
      'customer_return',
      btrim(p_return_type),
      btrim(p_return_reason),
      'status=' || v_status || '; device=' || v_record_device || '; '
        || btrim(p_return_type) || ' - ' || btrim(p_return_reason)
    )
    returning movement_id into v_movement_id;

    insert into public.return_records (
      movement_id,
      operation_id,
      created_at,
      actor,
      actor_id,
      item_id,
      imei,
      device_id,
      reported_device,
      return_ref,
      customer,
      sur_id,
      courier,
      country_code,
      return_status,
      return_type,
      return_reason,
      previous_box,
      previous_floor,
      target_box,
      target_floor,
      stock_action
    )
    values (
      v_movement_id,
      p_operation_id,
      v_now,
      btrim(p_actor),
      p_actor_id,
      v_item.item_id,
      v_item.imei,
      v_item.device_id,
      v_record_device,
      btrim(p_return_ref),
      btrim(p_customer),
      btrim(p_sur_id),
      v_courier,
      v_country_code,
      v_status,
      btrim(p_return_type),
      btrim(p_return_reason),
      v_item.previous_box,
      v_item.previous_floor,
      case when v_status = 'available' then btrim(p_target_box) else null end,
      case when v_status = 'available' then btrim(p_target_floor) else null end,
      case when v_status = 'available' then 'added_to_stock' else 'no_stock_change' end
    );

    v_recorded := v_recorded + 1;
  end loop;

  v_result := jsonb_build_object(
    'ok', true,
    'operation_id', p_operation_id,
    'created_at', v_now,
    'return_status', v_status,
    'reported_device', case when v_status = 'available' then null else v_reported_device end,
    'recorded', v_recorded,
    'returned', v_added_to_stock,
    'added_to_stock', v_added_to_stock,
    'logged_only', v_logged_only,
    'created_boxes', v_created_boxes,
    'reused_boxes', v_reused_boxes
  );

  update public.inventory_command_receipts
  set result = v_result
  where operation_id = p_operation_id;

  return v_result;
end;
$$;

revoke all on function public.confirm_return_batch(
  uuid, uuid, text, uuid[], text, text, text, text, text, text, text, text, text, text, text
) from public, anon, authenticated;
grant execute on function public.confirm_return_batch(
  uuid, uuid, text, uuid[], text, text, text, text, text, text, text, text, text, text, text
) to service_role;

comment on function public.confirm_return_batch(
  uuid, uuid, text, uuid[], text, text, text, text, text, text, text, text, text, text, text
) is
  'Uses canonical device data for Available returns and a validated reported device for non-stock returns.';

create or replace function public.get_return_history_page(
  p_cursor_created_at timestamptz default null,
  p_cursor_history_key text default null,
  p_limit integer default 51,
  p_search text default null,
  p_month date default null,
  p_return_status text default null,
  p_courier text default null,
  p_country_code text default null
)
returns table (
  history_key text,
  operation_id uuid,
  created_at timestamptz,
  actor text,
  return_ref text,
  return_type text,
  return_reason text,
  qty integer,
  customer text,
  sur_id text,
  courier text,
  country_code text,
  return_status text,
  device text,
  imei text,
  previous_box text,
  previous_floor text,
  target_box text,
  target_floor text,
  stock_action text
)
language sql
security definer
set search_path = pg_catalog, public
as $$
  select
    r.id::text,
    r.operation_id,
    r.created_at,
    r.actor,
    r.return_ref,
    r.return_type,
    r.return_reason,
    1,
    r.customer,
    r.sur_id,
    r.courier,
    r.country_code,
    r.return_status,
    coalesce(nullif(btrim(r.reported_device), ''), b.name, ''),
    r.imei,
    r.previous_box,
    r.previous_floor,
    r.target_box,
    r.target_floor,
    r.stock_action
  from public.return_records r
  left join public.bins b on b.id = r.device_id
  where (
    (
      p_cursor_created_at is null
      and p_cursor_history_key is null
    ) or (
      p_cursor_created_at is not null
      and p_cursor_history_key is not null
      and (r.created_at, r.id::text)
        < (p_cursor_created_at, p_cursor_history_key)
    )
  )
  and (
    nullif(btrim(coalesce(p_search, '')), '') is null
    or lower(concat_ws(
      ' ',
      r.return_ref,
      r.sur_id,
      r.customer,
      r.imei,
      r.actor,
      r.reported_device,
      b.name
    )) like '%' || lower(btrim(p_search)) || '%'
  )
  and (
    p_month is null
    or (
      r.created_at >= (p_month::timestamp at time zone 'Europe/Brussels')
      and r.created_at < ((p_month + interval '1 month')::timestamp at time zone 'Europe/Brussels')
    )
  )
  and (
    nullif(btrim(coalesce(p_return_status, '')), '') is null
    or r.return_status = lower(btrim(p_return_status))
  )
  and (
    nullif(btrim(coalesce(p_courier, '')), '') is null
    or r.courier = upper(btrim(p_courier))
  )
  and (
    nullif(btrim(coalesce(p_country_code, '')), '') is null
    or r.country_code = upper(btrim(p_country_code))
  )
  order by r.created_at desc, r.id desc
  limit least(greatest(coalesce(p_limit, 51), 1), 51);
$$;

revoke all on function public.get_return_history_page(
  timestamptz, text, integer, text, date, text, text, text
) from public, anon, authenticated;
grant execute on function public.get_return_history_page(
  timestamptz, text, integer, text, date, text, text, text
) to service_role;

comment on column public.return_records.reported_device is
  'Canonical device for Available returns, or the operator-selected device for non-stock returns.';

commit;
