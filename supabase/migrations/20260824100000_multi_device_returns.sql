begin;

create or replace function public.resolve_return_device_name(
  p_device text
)
returns text
language plpgsql
stable
security definer
set search_path = pg_catalog, public
as $$
declare
  v_requested text := nullif(btrim(coalesce(p_device, '')), '');
  v_resolved text;
begin
  if v_requested is null or char_length(v_requested) > 200 then
    return null;
  end if;

  select b.name
  into v_resolved
  from public.bins b
  where lower(btrim(b.name)) = lower(v_requested)
  order by b.active desc, b.name
  limit 1;

  if v_resolved is not null then
    return v_resolved;
  end if;

  return case upper(v_requested)
    when 'LMU2640' then 'LMU2640'
    when 'LMU30G600' then 'LMU30G600'
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
end;
$$;

revoke all on function public.resolve_return_device_name(text)
  from public, anon, authenticated;
grant execute on function public.resolve_return_device_name(text)
  to service_role;

create or replace function public.confirm_return_batch_v4(
  p_operation_id uuid,
  p_actor_id uuid,
  p_actor text,
  p_items jsonb,
  p_target_box text,
  p_target_floor text,
  p_return_ref text,
  p_return_reason text,
  p_return_status text,
  p_courier text,
  p_country_code text,
  p_customer text,
  p_sur_id text
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  v_existing_command text;
  v_existing_actor uuid;
  v_existing_result jsonb;
  v_item_ids uuid[] := array[]::uuid[];
  v_unknown_imeis text[] := array[]::text[];
  v_status text := lower(btrim(coalesce(p_return_status, '')));
  v_first_device text;
  v_single_device text;
  v_device_count integer := 0;
  v_result jsonb;
begin
  if p_operation_id is null
    or p_actor_id is null
    or nullif(btrim(coalesce(p_actor, '')), '') is null then
    raise exception 'RETURN_IDENTITY_REQUIRED' using errcode = '22023';
  end if;

  if jsonb_typeof(p_items) is distinct from 'array' then
    raise exception 'RETURN_ITEM_LIMIT' using errcode = '22023';
  end if;

  if jsonb_array_length(p_items) not between 1 and 500 then
    raise exception 'RETURN_ITEM_LIMIT' using errcode = '22023';
  end if;

  if exists (
    select 1
    from jsonb_array_elements(p_items) as entry(item)
    where jsonb_typeof(entry.item) is distinct from 'object'
      or (
        nullif(entry.item ->> 'item_id', '') is null
        and nullif(entry.item ->> 'imei', '') is null
      )
      or (
        nullif(entry.item ->> 'item_id', '') is not null
        and (entry.item ->> 'item_id') !~*
          '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
      )
      or (
        nullif(entry.item ->> 'imei', '') is not null
        and (entry.item ->> 'imei') !~ '^[0-9]{15}$'
      )
  ) then
    raise exception 'RETURN_ITEM_INVALID' using errcode = '22023';
  end if;

  if (
    select count(*)
    from jsonb_array_elements(p_items)
  ) <> (
    select count(distinct coalesce(
      nullif(entry.item ->> 'item_id', ''),
      'imei:' || nullif(entry.item ->> 'imei', '')
    ))
    from jsonb_array_elements(p_items) as entry(item)
  ) then
    raise exception 'RETURN_ITEM_DUPLICATE' using errcode = '22023';
  end if;

  if v_status = 'available' and exists (
    select 1
    from jsonb_array_elements(p_items) as entry(item)
    where nullif(entry.item ->> 'item_id', '') is null
  ) then
    raise exception 'RETURN_UNKNOWN_AVAILABLE_ITEM' using errcode = 'P0002';
  end if;

  if v_status <> 'available' and exists (
    select 1
    from jsonb_array_elements(p_items) as entry(item)
    where public.resolve_return_device_name(
      entry.item ->> 'reported_device'
    ) is null
  ) then
    raise exception 'RETURN_DEVICE_INVALID' using errcode = '22023';
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

  select coalesce(
    array_agg(distinct (entry.item ->> 'item_id')::uuid),
    array[]::uuid[]
  )
  into v_item_ids
  from jsonb_array_elements(p_items) as entry(item)
  where nullif(entry.item ->> 'item_id', '') is not null;

  select coalesce(
    array_agg(distinct entry.item ->> 'imei'),
    array[]::text[]
  )
  into v_unknown_imeis
  from jsonb_array_elements(p_items) as entry(item)
  where nullif(entry.item ->> 'item_id', '') is null;

  if v_status <> 'available' then
    select public.resolve_return_device_name(
      entry.item ->> 'reported_device'
    )
    into v_first_device
    from jsonb_array_elements(p_items) as entry(item)
    limit 1;
  end if;

  select public.confirm_return_batch_v3(
    p_operation_id,
    p_actor_id,
    p_actor,
    v_item_ids,
    v_unknown_imeis,
    p_target_box,
    p_target_floor,
    p_return_ref,
    p_return_reason,
    p_return_status,
    p_courier,
    p_country_code,
    p_customer,
    p_sur_id,
    v_first_device
  )
  into v_result;

  if v_status <> 'available' then
    with requested as (
      select
        nullif(entry.item ->> 'item_id', '')::uuid as item_id,
        nullif(entry.item ->> 'imei', '') as imei,
        public.resolve_return_device_name(
          entry.item ->> 'reported_device'
        ) as reported_device
      from jsonb_array_elements(p_items) as entry(item)
    )
    update public.return_records records
    set reported_device = requested.reported_device
    from requested
    where records.operation_id = p_operation_id
      and (
        (requested.item_id is not null and records.item_id = requested.item_id)
        or (
          requested.item_id is null
          and requested.imei is not null
          and records.imei = requested.imei
        )
      );

    select
      count(distinct records.reported_device)::integer,
      min(records.reported_device)
    into v_device_count, v_single_device
    from public.return_records records
    where records.operation_id = p_operation_id;

    v_result := jsonb_set(
      v_result,
      '{reported_device}',
      case
        when v_device_count = 1 then to_jsonb(v_single_device)
        else 'null'::jsonb
      end,
      true
    );
    v_result := jsonb_set(
      v_result,
      '{device_count}',
      to_jsonb(v_device_count),
      true
    );

    update public.inventory_command_receipts receipt
    set result = v_result
    where receipt.operation_id = p_operation_id
      and receipt.command_type = 'return';
  end if;

  return v_result;
end;
$$;

revoke all on function public.confirm_return_batch_v4(
  uuid, uuid, text, jsonb, text, text, text, text, text, text, text, text,
  text
) from public, anon, authenticated;
grant execute on function public.confirm_return_batch_v4(
  uuid, uuid, text, jsonb, text, text, text, text, text, text, text, text,
  text
) to service_role;

comment on function public.confirm_return_batch_v4(
  uuid, uuid, text, jsonb, text, text, text, text, text, text, text, text,
  text
) is
  'Confirms one customer return operation containing multiple device models with a validated device per non-stock IMEI.';

commit;
