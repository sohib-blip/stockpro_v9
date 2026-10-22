begin;

-- Sleeves wrap Radius boxes. They are packaging stock without dimensions and
-- are never chosen as a container by the dispatch volume calculation.
alter table public.packaging_types
  drop constraint if exists packaging_types_category_check;
alter table public.packaging_types
  add constraint packaging_types_category_check
  check (category in ('BOX', 'BUBBLE_ENVELOPE', 'PLASTIC_ENVELOPE', 'SLEEVE'));

alter table public.packaging_types
  alter column length_cm drop not null,
  alter column width_cm drop not null,
  alter column height_cm drop not null;

alter table public.packaging_types
  drop constraint if exists packaging_types_length_cm_check,
  drop constraint if exists packaging_types_width_cm_check,
  drop constraint if exists packaging_types_height_cm_check,
  drop constraint if exists packaging_types_dimensions_check;
alter table public.packaging_types
  add constraint packaging_types_dimensions_check check (
    (
      category = 'SLEEVE'
      and length_cm is null and width_cm is null and height_cm is null
    )
    or (
      category <> 'SLEEVE'
      and length_cm is not null and length_cm > 0 and length_cm <= 1000
      and width_cm is not null and width_cm > 0 and width_cm <= 1000
      and height_cm is not null and height_cm > 0 and height_cm <= 1000
    )
  );

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
    or p_category is null
    or p_category not in ('BOX', 'BUBBLE_ENVELOPE', 'PLASTIC_ENVELOPE', 'SLEEVE')
    or (
      p_category = 'SLEEVE'
      and (p_length_cm is not null or p_width_cm is not null or p_height_cm is not null)
    )
    or (
      p_category <> 'SLEEVE'
      and (
        p_length_cm is null or p_length_cm <= 0 or p_length_cm > 1000
        or p_width_cm is null or p_width_cm <= 0 or p_width_cm > 1000
        or p_height_cm is null or p_height_cm <= 0 or p_height_cm > 1000
      )
    )
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

-- Automatic packaging rules: extra packaging removed with a dispatch, either
-- for every package of a format (Radius Box Small -> Small Sleeve) or for
-- every device of a model (CNHYCV200XEU -> CV200 Sleeve).
create table if not exists public.packaging_rules (
  id uuid primary key default gen_random_uuid(),
  trigger_packaging_type_id uuid references public.packaging_types(id) on delete cascade,
  trigger_device_id uuid references public.bins(id) on delete cascade,
  packaging_type_id uuid not null references public.packaging_types(id) on delete cascade,
  quantity integer not null check (quantity between 1 and 1000),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  updated_by_email text,
  constraint packaging_rules_single_trigger
    check (num_nonnulls(trigger_packaging_type_id, trigger_device_id) = 1),
  constraint packaging_rules_not_itself
    check (trigger_packaging_type_id is distinct from packaging_type_id)
);

create unique index if not exists packaging_rules_packaging_trigger_unique
  on public.packaging_rules (trigger_packaging_type_id, packaging_type_id)
  where trigger_packaging_type_id is not null;
create unique index if not exists packaging_rules_device_trigger_unique
  on public.packaging_rules (trigger_device_id, packaging_type_id)
  where trigger_device_id is not null;

alter table public.packaging_rules enable row level security;
revoke all on table public.packaging_rules from public, anon, authenticated;
grant select, insert, update, delete on table public.packaging_rules to service_role;

commit;
