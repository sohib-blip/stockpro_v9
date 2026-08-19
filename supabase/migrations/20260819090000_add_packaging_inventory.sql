begin;

create table if not exists public.packaging_types (
  id uuid primary key default gen_random_uuid(),
  code text not null unique,
  name text not null,
  category text not null check (
    category in ('BOX', 'BUBBLE_ENVELOPE', 'PLASTIC_ENVELOPE')
  ),
  length_cm numeric(10, 2) not null check (length_cm > 0 and length_cm <= 1000),
  width_cm numeric(10, 2) not null check (width_cm > 0 and width_cm <= 1000),
  height_cm numeric(10, 2) not null check (height_cm > 0 and height_cm <= 1000),
  on_hand_stock integer not null default 0 check (on_hand_stock >= 0),
  reserved_stock integer not null default 0 check (reserved_stock >= 0),
  minimum_stock integer not null default 0 check (minimum_stock >= 0),
  active boolean not null default true,
  sort_order integer not null default 0,
  source_name text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by_id uuid references auth.users(id) on delete set null,
  created_by_email text,
  updated_by_id uuid references auth.users(id) on delete set null,
  updated_by_email text,
  constraint packaging_reserved_within_stock
    check (reserved_stock <= on_hand_stock),
  constraint packaging_code_format
    check (code ~ '^[A-Z0-9][A-Z0-9_-]{1,49}$'),
  constraint packaging_name_length
    check (char_length(btrim(name)) between 1 and 120)
);

create unique index if not exists packaging_types_name_unique
  on public.packaging_types (lower(name));
create index if not exists packaging_types_display_idx
  on public.packaging_types (active desc, category, sort_order, name);

create table if not exists public.packaging_stock_movements (
  id uuid primary key default gen_random_uuid(),
  operation_id uuid not null unique,
  packaging_type_id uuid not null
    references public.packaging_types(id) on delete restrict,
  movement_type text not null check (
    movement_type in (
      'RECEIVE',
      'REMOVE',
      'COUNT_ADJUSTMENT',
      'RESERVE',
      'RELEASE',
      'CONSUME'
    )
  ),
  on_hand_delta integer not null default 0,
  reserved_delta integer not null default 0,
  on_hand_before integer not null check (on_hand_before >= 0),
  on_hand_after integer not null check (on_hand_after >= 0),
  reserved_before integer not null check (reserved_before >= 0),
  reserved_after integer not null check (reserved_after >= 0),
  reason text not null check (char_length(btrim(reason)) between 1 and 500),
  actor_id uuid references auth.users(id) on delete set null,
  actor_email text not null,
  created_at timestamptz not null default now(),
  constraint packaging_movement_has_change
    check (on_hand_delta <> 0 or reserved_delta <> 0),
  constraint packaging_movement_reserved_valid
    check (reserved_after <= on_hand_after)
);

create index if not exists packaging_stock_movements_packaging_idx
  on public.packaging_stock_movements (packaging_type_id, created_at desc, id desc);
create index if not exists packaging_stock_movements_created_idx
  on public.packaging_stock_movements (created_at desc, id desc);

alter table public.packaging_types enable row level security;
alter table public.packaging_stock_movements enable row level security;

revoke all on table public.packaging_types
  from public, anon, authenticated;
revoke all on table public.packaging_stock_movements
  from public, anon, authenticated;
grant select, insert, update, delete on table public.packaging_types
  to service_role;
grant select, insert, update, delete on table public.packaging_stock_movements
  to service_role;

insert into public.packaging_types (
  code,
  name,
  category,
  length_cm,
  width_cm,
  height_cm,
  sort_order,
  source_name
)
values
  ('TBD012', 'Normal Box A', 'BOX', 23, 19, 12, 10, 'Normal box A-23/19/12'),
  ('TBD013', 'Normal Box B', 'BOX', 31, 22, 15, 20, 'Normal box B-31/22/15'),
  ('TBD014', 'Normal Box C', 'BOX', 40, 30, 18, 30, 'Normal box C-40/30/18'),
  ('TBD015', 'Normal Box D', 'BOX', 50, 33, 25, 40, 'Normal box D-50/33/25'),
  ('TBD016', 'Normal Box E', 'BOX', 60, 40, 40, 50, 'Normal box E-60/40/40'),
  ('TBD007', 'Radius Box Small', 'BOX', 15, 11, 5, 60, 'Radius Box Small-15/11/5'),
  ('TBD008', 'Radius Box Medium', 'BOX', 20, 13, 5, 70, 'Radius Box Medium-20/13/5'),
  ('TBD009', 'Radius Box Large', 'BOX', 22, 19, 5, 80, 'Radius Box Large-22/19/5'),
  ('TBD010', 'Radius Box X-Large', 'BOX', 32, 18, 11, 90, 'Radius Box X-Large-32/18/11'),
  ('SBE27X20', 'Small Bubble Envelope', 'BUBBLE_ENVELOPE', 27, 20, 0.5, 100, 'Small Bubble enveloppe'),
  ('MBE37X29', 'Medium Bubble Envelope', 'BUBBLE_ENVELOPE', 37, 29, 0.5, 110, 'Medium Bubble enveloppe'),
  ('PCR25B', 'Small Plastic Envelope', 'PLASTIC_ENVELOPE', 24, 35, 0.1, 120, 'SMALL PLASTIC ENVELOPE 24X35 -PCR25B'),
  ('PCR34B', 'Medium Plastic Envelope', 'PLASTIC_ENVELOPE', 34, 45, 0.1, 130, 'MEDIUM PLASTIC ENVELOPE 34X45 -PCR34B'),
  ('PLASTIC-L-50X38', 'Large Plastic Envelope', 'PLASTIC_ENVELOPE', 50, 38, 0.1, 140, 'LARGE PLASTIC ENVELOPE 50/38')
on conflict (code) do update
set name = excluded.name,
    category = excluded.category,
    length_cm = excluded.length_cm,
    width_cm = excluded.width_cm,
    height_cm = excluded.height_cm,
    sort_order = excluded.sort_order,
    source_name = excluded.source_name,
    updated_at = clock_timestamp();

create or replace function public.adjust_packaging_stock(
  p_operation_id uuid,
  p_actor_id uuid,
  p_actor text,
  p_packaging_type_id uuid,
  p_mode text,
  p_quantity integer,
  p_reason text
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
  v_delta integer;
  v_after integer;
  v_movement_type text;
  v_result jsonb;
  v_now timestamptz := clock_timestamp();
begin
  if p_operation_id is null
    or p_actor_id is null
    or nullif(btrim(coalesce(p_actor, '')), '') is null then
    raise exception 'PACKAGING_IDENTITY_REQUIRED' using errcode = '22023';
  end if;

  if p_packaging_type_id is null
    or lower(coalesce(p_mode, '')) not in ('receive', 'remove', 'set')
    or p_quantity is null
    or p_quantity < 0
    or p_quantity > 10000000
    or nullif(btrim(coalesce(p_reason, '')), '') is null
    or char_length(btrim(p_reason)) > 500 then
    raise exception 'PACKAGING_ADJUSTMENT_INVALID' using errcode = '22023';
  end if;

  if lower(p_mode) in ('receive', 'remove') and p_quantity = 0 then
    raise exception 'PACKAGING_ADJUSTMENT_INVALID' using errcode = '22023';
  end if;

  insert into public.inventory_command_receipts (
    operation_id,
    command_type,
    actor_id
  )
  values (
    p_operation_id,
    'packaging_adjustment',
    p_actor_id
  )
  on conflict (operation_id) do nothing;

  get diagnostics v_receipt_inserted = row_count;

  if v_receipt_inserted = 0 then
    select receipt.command_type, receipt.actor_id, receipt.result
    into v_existing_command, v_existing_actor, v_existing_result
    from public.inventory_command_receipts receipt
    where receipt.operation_id = p_operation_id;

    if v_existing_command is distinct from 'packaging_adjustment'
      or v_existing_actor is distinct from p_actor_id then
      raise exception 'OPERATION_ID_CONFLICT' using errcode = '23505';
    end if;

    if v_existing_result is null then
      raise exception 'OPERATION_RESULT_UNAVAILABLE' using errcode = '40001';
    end if;

    return v_existing_result;
  end if;

  select packaging.*
  into v_packaging
  from public.packaging_types packaging
  where packaging.id = p_packaging_type_id
  for update of packaging;

  if not found then
    raise exception 'PACKAGING_NOT_FOUND' using errcode = 'P0002';
  end if;

  if not v_packaging.active then
    raise exception 'PACKAGING_INACTIVE' using errcode = '23514';
  end if;

  if lower(p_mode) = 'receive' then
    v_delta := p_quantity;
    v_movement_type := 'RECEIVE';
  elsif lower(p_mode) = 'remove' then
    v_delta := -p_quantity;
    v_movement_type := 'REMOVE';
  else
    v_delta := p_quantity - v_packaging.on_hand_stock;
    v_movement_type := 'COUNT_ADJUSTMENT';
  end if;

  if v_delta = 0 then
    raise exception 'PACKAGING_NO_STOCK_CHANGE' using errcode = '22023';
  end if;

  v_after := v_packaging.on_hand_stock + v_delta;
  if v_after < v_packaging.reserved_stock then
    raise exception 'PACKAGING_STOCK_BELOW_RESERVED:%:%:%',
      v_packaging.name,
      v_after,
      v_packaging.reserved_stock
      using errcode = '23514';
  end if;

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
  )
  values (
    p_operation_id,
    v_packaging.id,
    v_movement_type,
    v_delta,
    0,
    v_packaging.on_hand_stock,
    v_after,
    v_packaging.reserved_stock,
    v_packaging.reserved_stock,
    btrim(p_reason),
    p_actor_id,
    btrim(p_actor),
    v_now
  );

  v_result := jsonb_build_object(
    'ok', true,
    'operation_id', p_operation_id,
    'row', jsonb_build_object(
      'id', v_packaging.id,
      'code', v_packaging.code,
      'name', v_packaging.name,
      'on_hand_stock', v_after,
      'reserved_stock', v_packaging.reserved_stock,
      'available_stock', v_after - v_packaging.reserved_stock,
      'minimum_stock', v_packaging.minimum_stock
    )
  );

  update public.inventory_command_receipts
  set result = v_result
  where operation_id = p_operation_id;

  return v_result;
end;
$$;

revoke all on function public.adjust_packaging_stock(
  uuid, uuid, text, uuid, text, integer, text
) from public, anon, authenticated;
grant execute on function public.adjust_packaging_stock(
  uuid, uuid, text, uuid, text, integer, text
) to service_role;

commit;
