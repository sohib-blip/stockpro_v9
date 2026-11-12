begin;

-- Accessory stock set at creation or changed by hand in Inventory Setup now
-- leaves a COUNT_ADJUSTMENT movement with the stock before and after, like the
-- packaging stock counts. Existing movements are not changed.

alter table public.accessory_movements
  add column if not exists stock_before integer,
  add column if not exists stock_after integer;

-- If a check constraint limits movement_type, let it also accept
-- COUNT_ADJUSTMENT (and every type already stored, so no existing row breaks).
-- A constraint that also checks other columns is not rewritten: stop instead.
do $$
declare
  v_constraint record;
  v_dropped integer := 0;
  v_allowed text;
begin
  for v_constraint in
    select con.conname, pg_get_constraintdef(con.oid) as definition
    from pg_constraint con
    where con.conrelid = 'public.accessory_movements'::regclass
      and con.contype = 'c'
      and pg_get_constraintdef(con.oid) ilike '%movement_type%'
      and pg_get_constraintdef(con.oid) not ilike '%COUNT_ADJUSTMENT%'
  loop
    if v_constraint.definition ~* '\m(qty|source|shipment_ref|order_ref|note|comment|actor|actor_id|operation_id|accessory_bin_id|created_at)\M' then
      raise exception 'accessory_movements constraint % also checks other columns: review it by hand (%)',
        v_constraint.conname, v_constraint.definition;
    end if;

    execute format(
      'alter table public.accessory_movements drop constraint %I',
      v_constraint.conname
    );
    v_dropped := v_dropped + 1;
  end loop;

  -- Tables without such a constraint stay without one.
  if v_dropped > 0 then
    select string_agg(quote_literal(types.movement_type), ', ' order by types.movement_type)
    into v_allowed
    from (
      select 'IN'::text as movement_type
      union select 'OUT'
      union select 'COUNT_ADJUSTMENT'
      union select distinct movement.movement_type
        from public.accessory_movements movement
        where movement.movement_type is not null
    ) types;

    execute format(
      'alter table public.accessory_movements add constraint accessory_movements_movement_type_check check (movement_type in (%s))',
      v_allowed
    );
  end if;
end
$$;

create or replace function public.save_accessory_stock_count(
  p_operation_id uuid,
  p_accessory_bin_id uuid,
  p_stock integer,
  p_actor_id uuid,
  p_actor text,
  p_reason text
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  v_before integer;
  v_recorded boolean := false;
begin
  if p_operation_id is null
    or p_accessory_bin_id is null
    or p_actor_id is null
    or nullif(btrim(coalesce(p_actor, '')), '') is null then
    raise exception 'ACCESSORY_IDENTITY_REQUIRED' using errcode = '22023';
  end if;

  if p_stock is null
    or p_stock < 0
    or p_stock > 1000000
    or nullif(btrim(coalesce(p_reason, '')), '') is null
    or char_length(p_reason) > 200 then
    raise exception 'ACCESSORY_STOCK_COUNT_INVALID' using errcode = '22023';
  end if;

  select coalesce(bin.current_stock, 0)
  into v_before
  from public.accessory_bins bin
  where bin.id = p_accessory_bin_id
  for update;

  if not found then
    raise exception 'ACCESSORY_BINS_NOT_FOUND' using errcode = 'P0002';
  end if;

  if v_before <> p_stock then
    update public.accessory_bins
    set current_stock = p_stock
    where id = p_accessory_bin_id;

    insert into public.accessory_movements (
      accessory_bin_id,
      qty,
      movement_type,
      note,
      actor,
      actor_id,
      source,
      operation_id,
      stock_before,
      stock_after
    )
    values (
      p_accessory_bin_id,
      abs(p_stock - v_before),
      'COUNT_ADJUSTMENT',
      btrim(p_reason),
      btrim(p_actor),
      p_actor_id,
      'manual',
      p_operation_id,
      v_before,
      p_stock
    );

    v_recorded := true;
  end if;

  return jsonb_build_object(
    'ok', true,
    'accessory_bin_id', p_accessory_bin_id,
    'stock_before', v_before,
    'stock_after', p_stock,
    'recorded', v_recorded
  );
end;
$$;

revoke all on function public.save_accessory_stock_count(
  uuid, uuid, integer, uuid, text, text
) from public, anon, authenticated;
grant execute on function public.save_accessory_stock_count(
  uuid, uuid, integer, uuid, text, text
) to service_role;

commit;
