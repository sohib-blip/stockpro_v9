begin;

-- Non-stock returns are an audit workflow. An IMEI that has never existed in
-- canonical inventory therefore has no movement, item or bin foreign key.
-- Available returns keep the existing strict canonical inventory path.
alter table public.return_records
  alter column movement_id drop not null,
  alter column item_id drop not null,
  alter column device_id drop not null;

create unique index if not exists return_records_operation_imei_idx
  on public.return_records (operation_id, imei)
  where operation_id is not null;

create or replace function public.confirm_return_batch_v2(
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
  p_reported_device text,
  p_unknown_imeis text[]
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
  v_known_count integer;
  v_unknown_count integer;
  v_unknown_inserted integer := 0;
  v_unknown_imei text;
  v_unknown_imeis text[] := array[]::text[];
  v_status text := lower(btrim(coalesce(p_return_status, '')));
  v_courier text := upper(btrim(coalesce(p_courier, '')));
  v_country_code text := upper(btrim(coalesce(p_country_code, '')));
  v_requested_device text := nullif(btrim(coalesce(p_reported_device, '')), '');
  v_reported_device text;
  v_known_result jsonb;
  v_created_at timestamptz := clock_timestamp();
  v_recorded integer := 0;
  v_added_to_stock integer := 0;
  v_logged_only integer := 0;
  v_result jsonb;
begin
  if p_operation_id is null
    or p_actor_id is null
    or nullif(btrim(p_actor), '') is null then
    raise exception 'RETURN_IDENTITY_REQUIRED' using errcode = '22023';
  end if;

  select count(distinct requested.item_id)
  into v_known_count
  from unnest(coalesce(p_item_ids, array[]::uuid[])) as requested(item_id)
  where requested.item_id is not null;

  select coalesce(array_agg(candidate.imei order by candidate.imei), array[]::text[])
  into v_unknown_imeis
  from (
    select distinct btrim(raw.imei) as imei
    from unnest(coalesce(p_unknown_imeis, array[]::text[])) as raw(imei)
    where nullif(btrim(raw.imei), '') is not null
  ) candidate;

  v_unknown_count := cardinality(v_unknown_imeis);

  if v_known_count + v_unknown_count not between 1 and 500 then
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
    or btrim(coalesce(p_return_type, '')) not in ('cancellation_stop', 'technical_stop')
    or nullif(btrim(p_return_reason), '') is null
    or char_length(btrim(p_return_reason)) > 1000 then
    raise exception 'RETURN_METADATA_INVALID' using errcode = '22023';
  end if;

  if v_status = 'available' and v_unknown_count > 0 then
    raise exception 'RETURN_UNKNOWN_AVAILABLE_ITEM' using errcode = 'P0002';
  end if;

  if exists (
    select 1
    from unnest(v_unknown_imeis) as requested(imei)
    where requested.imei !~ '^[0-9]{15}$'
  ) then
    raise exception 'RETURN_IMEI_INVALID' using errcode = '22023';
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

  -- An IMEI classified as unknown during preview must still be absent at
  -- confirmation time. If it appeared meanwhile, the operator must preview
  -- again so canonical data cannot be bypassed.
  if v_unknown_count > 0 and exists (
    select 1
    from public.items i
    where i.imei = any(v_unknown_imeis)
  ) then
    raise exception 'RETURN_ITEM_STATE_CHANGED' using errcode = '40001';
  end if;

  select receipt.command_type, receipt.actor_id, receipt.result
  into v_existing_command, v_existing_actor, v_existing_result
  from public.inventory_command_receipts receipt
  where receipt.operation_id = p_operation_id;

  if found then
    if v_existing_command is distinct from 'return'
      or v_existing_actor is distinct from p_actor_id then
      raise exception 'OPERATION_ID_CONFLICT' using errcode = '23505';
    end if;
    if v_existing_result is null then
      raise exception 'OPERATION_RESULT_UNAVAILABLE' using errcode = '40001';
    end if;
    return v_existing_result;
  end if;

  if v_known_count > 0 then
    select public.confirm_return_batch(
      p_operation_id,
      p_actor_id,
      p_actor,
      p_item_ids,
      p_target_box,
      p_target_floor,
      p_return_ref,
      p_return_type,
      p_return_reason,
      p_return_status,
      p_courier,
      p_country_code,
      p_customer,
      p_sur_id,
      p_reported_device
    )
    into v_known_result;

    v_created_at := coalesce(
      (v_known_result ->> 'created_at')::timestamptz,
      v_created_at
    );
  else
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
      select receipt.command_type, receipt.actor_id, receipt.result
      into v_existing_command, v_existing_actor, v_existing_result
      from public.inventory_command_receipts receipt
      where receipt.operation_id = p_operation_id;

      if v_existing_command is distinct from 'return'
        or v_existing_actor is distinct from p_actor_id then
        raise exception 'OPERATION_ID_CONFLICT' using errcode = '23505';
      end if;
      if v_existing_result is null then
        raise exception 'OPERATION_RESULT_UNAVAILABLE' using errcode = '40001';
      end if;
      return v_existing_result;
    end if;
  end if;

  foreach v_unknown_imei in array v_unknown_imeis
  loop
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
      null,
      p_operation_id,
      v_created_at,
      btrim(p_actor),
      p_actor_id,
      null,
      v_unknown_imei,
      null,
      v_reported_device,
      btrim(p_return_ref),
      btrim(p_customer),
      btrim(p_sur_id),
      v_courier,
      v_country_code,
      v_status,
      btrim(p_return_type),
      btrim(p_return_reason),
      '',
      '',
      null,
      null,
      'no_stock_change'
    )
    on conflict (operation_id, imei)
      where operation_id is not null
      do nothing;

    get diagnostics v_receipt_inserted = row_count;
    v_unknown_inserted := v_unknown_inserted + v_receipt_inserted;
  end loop;

  select
    count(*)::integer,
    count(*) filter (where records.stock_action = 'added_to_stock')::integer,
    count(*) filter (where records.stock_action = 'no_stock_change')::integer
  into v_recorded, v_added_to_stock, v_logged_only
  from public.return_records records
  where records.operation_id = p_operation_id;

  v_result := jsonb_build_object(
    'ok', true,
    'operation_id', p_operation_id,
    'created_at', v_created_at,
    'return_status', v_status,
    'reported_device', case when v_status = 'available' then null else v_reported_device end,
    'recorded', v_recorded,
    'returned', v_added_to_stock,
    'added_to_stock', v_added_to_stock,
    'logged_only', v_logged_only,
    'unknown_logged', v_unknown_inserted,
    'created_boxes', coalesce((v_known_result ->> 'created_boxes')::integer, 0),
    'reused_boxes', coalesce((v_known_result ->> 'reused_boxes')::integer, 0)
  );

  update public.inventory_command_receipts
  set result = v_result
  where operation_id = p_operation_id;

  return v_result;
end;
$$;

revoke all on function public.confirm_return_batch_v2(
  uuid, uuid, text, uuid[], text, text, text, text, text, text, text, text, text, text, text, text[]
) from public, anon, authenticated;
grant execute on function public.confirm_return_batch_v2(
  uuid, uuid, text, uuid[], text, text, text, text, text, text, text, text, text, text, text, text[]
) to service_role;

comment on function public.confirm_return_batch_v2(
  uuid, uuid, text, uuid[], text, text, text, text, text, text, text, text, text, text, text, text[]
) is
  'Confirms canonical Available returns and audit-only non-stock returns, including IMEIs absent from inventory.';

comment on column public.return_records.item_id is
  'Canonical item when known; null only for audit-only non-stock returns whose IMEI is absent from inventory.';

comment on column public.return_records.movement_id is
  'Inventory movement when canonical stock is involved; null for unknown audit-only non-stock returns.';

commit;
