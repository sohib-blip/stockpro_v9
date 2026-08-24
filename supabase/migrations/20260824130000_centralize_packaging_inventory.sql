begin;

-- Packaging Inventory is the only editable source of packaging stock. Keep
-- historical Packages accessory rows only as inactive audit mirrors so old
-- movements and references remain readable.
update public.packaging_types packaging
set on_hand_stock = greatest(
      coalesce(accessory.current_stock, 0),
      packaging.reserved_stock
    ),
    minimum_stock = greatest(0, coalesce(accessory.minimum_stock, 0)),
    updated_at = clock_timestamp()
from public.accessory_bins accessory
where packaging.legacy_accessory_bin_id = accessory.id
  and (
    packaging.on_hand_stock is distinct from greatest(
      coalesce(accessory.current_stock, 0),
      packaging.reserved_stock
    )
    or packaging.minimum_stock is distinct from greatest(
      0,
      coalesce(accessory.minimum_stock, 0)
    )
  );

update public.accessory_bins
set active = false
where category = 'Packages'
  and active is distinct from false;

drop trigger if exists accessory_bins_sync_packaging_stock
  on public.accessory_bins;
drop function if exists public.sync_packaging_from_legacy_accessory();

create or replace function public.sync_legacy_accessory_from_packaging()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
begin
  if new.legacy_accessory_bin_id is null then
    return new;
  end if;

  update public.accessory_bins accessory
  set current_stock = new.on_hand_stock,
      minimum_stock = new.minimum_stock,
      active = false
  where accessory.id = new.legacy_accessory_bin_id
    and (
      accessory.current_stock is distinct from new.on_hand_stock
      or accessory.minimum_stock is distinct from new.minimum_stock
      or accessory.active is distinct from false
    );

  return new;
end;
$$;

drop trigger if exists packaging_types_sync_legacy_stock
  on public.packaging_types;
create trigger packaging_types_sync_legacy_stock
after update of on_hand_stock, minimum_stock
on public.packaging_types
for each row
execute function public.sync_legacy_accessory_from_packaging();

alter table public.accessory_bins
  drop constraint if exists accessory_bins_packages_inactive_check;
alter table public.accessory_bins
  add constraint accessory_bins_packages_inactive_check
  check (category is distinct from 'Packages' or active = false);

comment on column public.packaging_types.legacy_accessory_bin_id is
  'Read-only compatibility mirror for historical Packages accessory rows. Packaging Inventory is the canonical stock source.';

create or replace function public.save_packaging_inventory(
  p_operation_id uuid,
  p_actor_id uuid,
  p_actor text,
  p_packaging_type_id uuid,
  p_code text,
  p_name text,
  p_category text,
  p_length_cm numeric,
  p_width_cm numeric,
  p_height_cm numeric,
  p_on_hand_stock integer,
  p_minimum_stock integer
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
  v_packaging public.packaging_types%rowtype;
  v_packaging_id uuid;
  v_stock_before integer := 0;
  v_reserved_before integer := 0;
  v_stock_delta integer;
  v_now timestamptz := clock_timestamp();
  v_result jsonb;
begin
  if p_operation_id is null
    or p_actor_id is null
    or nullif(btrim(coalesce(p_actor, '')), '') is null then
    raise exception 'PACKAGING_IDENTITY_REQUIRED' using errcode = '22023';
  end if;

  if nullif(btrim(coalesce(p_code, '')), '') is null
    or upper(btrim(p_code)) !~ '^[A-Z0-9][A-Z0-9_-]{1,49}$'
    or char_length(btrim(coalesce(p_name, ''))) not between 1 and 120
    or p_category not in ('BOX', 'BUBBLE_ENVELOPE', 'PLASTIC_ENVELOPE')
    or p_length_cm is null or p_length_cm <= 0 or p_length_cm > 1000
    or p_width_cm is null or p_width_cm <= 0 or p_width_cm > 1000
    or p_height_cm is null or p_height_cm <= 0 or p_height_cm > 1000
    or p_on_hand_stock is null or p_on_hand_stock < 0 or p_on_hand_stock > 10000000
    or p_minimum_stock is null or p_minimum_stock < 0 or p_minimum_stock > 10000000 then
    raise exception 'PACKAGING_INVENTORY_INVALID' using errcode = '22023';
  end if;

  insert into public.inventory_command_receipts (
    operation_id,
    command_type,
    actor_id
  )
  values (
    p_operation_id,
    'packaging_inventory_save',
    p_actor_id
  )
  on conflict (operation_id) do nothing;

  get diagnostics v_receipt_inserted = row_count;

  if v_receipt_inserted = 0 then
    select receipt.command_type, receipt.actor_id, receipt.result
    into v_existing_command, v_existing_actor, v_existing_result
    from public.inventory_command_receipts receipt
    where receipt.operation_id = p_operation_id;

    if v_existing_command is distinct from 'packaging_inventory_save'
      or v_existing_actor is distinct from p_actor_id then
      raise exception 'OPERATION_ID_CONFLICT' using errcode = '23505';
    end if;

    if v_existing_result is null then
      raise exception 'OPERATION_RESULT_UNAVAILABLE' using errcode = '40001';
    end if;

    return v_existing_result;
  end if;

  if p_packaging_type_id is null then
    insert into public.packaging_types (
      code,
      name,
      category,
      length_cm,
      width_cm,
      height_cm,
      on_hand_stock,
      reserved_stock,
      minimum_stock,
      active,
      created_by_id,
      created_by_email,
      updated_by_id,
      updated_by_email,
      updated_at
    )
    values (
      upper(btrim(p_code)),
      btrim(p_name),
      p_category,
      p_length_cm,
      p_width_cm,
      p_height_cm,
      p_on_hand_stock,
      0,
      p_minimum_stock,
      true,
      p_actor_id,
      btrim(p_actor),
      p_actor_id,
      btrim(p_actor),
      v_now
    )
    returning * into v_packaging;

    v_packaging_id := v_packaging.id;
  else
    select packaging.*
    into v_packaging
    from public.packaging_types packaging
    where packaging.id = p_packaging_type_id
    for update of packaging;

    if not found then
      raise exception 'PACKAGING_NOT_FOUND' using errcode = 'P0002';
    end if;

    if p_on_hand_stock < v_packaging.reserved_stock then
      raise exception 'PACKAGING_STOCK_BELOW_RESERVED:%:%:%',
        v_packaging.name,
        p_on_hand_stock,
        v_packaging.reserved_stock
        using errcode = '23514';
    end if;

    v_stock_before := v_packaging.on_hand_stock;
    v_reserved_before := v_packaging.reserved_stock;
    v_packaging_id := v_packaging.id;

    update public.packaging_types packaging
    set code = upper(btrim(p_code)),
        name = btrim(p_name),
        category = p_category,
        length_cm = p_length_cm,
        width_cm = p_width_cm,
        height_cm = p_height_cm,
        on_hand_stock = p_on_hand_stock,
        minimum_stock = p_minimum_stock,
        updated_at = v_now,
        updated_by_id = p_actor_id,
        updated_by_email = btrim(p_actor)
    where packaging.id = v_packaging.id
    returning * into v_packaging;
  end if;

  v_stock_delta := p_on_hand_stock - v_stock_before;
  if v_stock_delta <> 0 then
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
    )
    values (
      p_operation_id,
      v_packaging_id,
      'COUNT_ADJUSTMENT',
      v_stock_delta,
      0,
      v_stock_before,
      p_on_hand_stock,
      v_reserved_before,
      v_reserved_before,
      case
        when p_packaging_type_id is null
          then 'Initial stock set in Packaging Inventory'
        else 'Stock count updated in Packaging Inventory'
      end,
      p_actor_id,
      btrim(p_actor),
      v_now
    );
  end if;

  v_result := jsonb_build_object(
    'ok', true,
    'operation_id', p_operation_id,
    'row', jsonb_build_object(
      'id', v_packaging.id,
      'code', v_packaging.code,
      'name', v_packaging.name,
      'on_hand_stock', v_packaging.on_hand_stock,
      'reserved_stock', v_packaging.reserved_stock,
      'available_stock', v_packaging.on_hand_stock - v_packaging.reserved_stock,
      'minimum_stock', v_packaging.minimum_stock
    )
  );

  update public.inventory_command_receipts
  set result = v_result
  where operation_id = p_operation_id;

  return v_result;
end;
$$;

revoke all on function public.save_packaging_inventory(
  uuid, uuid, text, uuid, text, text, text,
  numeric, numeric, numeric, integer, integer
) from public, anon, authenticated;
grant execute on function public.save_packaging_inventory(
  uuid, uuid, text, uuid, text, text, text,
  numeric, numeric, numeric, integer, integer
) to service_role;

insert into public.packaging_types (
  code,
  name,
  category,
  length_cm,
  width_cm,
  height_cm,
  on_hand_stock,
  reserved_stock,
  minimum_stock,
  active,
  sort_order,
  source_name
)
values (
  'PLASTIC-L-50X38',
  'Large Plastic Envelope',
  'PLASTIC_ENVELOPE',
  50,
  38,
  0.1,
  300,
  0,
  100,
  true,
  140,
  'LARGE PLASTIC ENVELOPE 50/38'
)
on conflict (code) do update
set name = excluded.name,
    category = excluded.category,
    length_cm = excluded.length_cm,
    width_cm = excluded.width_cm,
    height_cm = excluded.height_cm,
    on_hand_stock = greatest(300, public.packaging_types.reserved_stock),
    minimum_stock = 100,
    active = true,
    sort_order = excluded.sort_order,
    source_name = excluded.source_name,
    updated_at = clock_timestamp();

commit;
