begin;

create table if not exists public.dispatch_packaging_preferences (
  composition_key text primary key check (composition_key ~ '^[a-f0-9]{64}$'),
  composition jsonb not null check (jsonb_typeof(composition) = 'array'),
  packaging_type_id uuid not null
    references public.packaging_types(id) on delete restrict,
  package_quantity integer not null check (package_quantity between 1 and 1000000),
  confirmation_count integer not null check (confirmation_count between 1 and 1000000),
  last_confirmed_batch_id uuid not null
    references public.dispatch_batches(id) on delete cascade,
  last_actor_email text not null,
  last_confirmed_at timestamptz not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists dispatch_packaging_preferences_package_idx
  on public.dispatch_packaging_preferences (packaging_type_id);
create index if not exists dispatch_packaging_preferences_recent_idx
  on public.dispatch_packaging_preferences (last_confirmed_at desc);

alter table public.dispatch_packaging_preferences enable row level security;
revoke all on table public.dispatch_packaging_preferences
  from public, anon, authenticated;
grant select, insert, update, delete on table public.dispatch_packaging_preferences
  to service_role;

create or replace function public.refresh_dispatch_packaging_preference(
  p_composition_key text
)
returns void
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  v_latest record;
  v_count integer;
begin
  if coalesce(p_composition_key, '') !~ '^[a-f0-9]{64}$' then
    raise exception 'DISPATCH_COMPOSITION_KEY_INVALID' using errcode = '22023';
  end if;

  select
    batch.id as batch_id,
    batch.actor_email,
    batch.confirmed_at,
    order_row.value -> 'items' as composition,
    (order_row.value -> 'packages' -> 0 ->> 'packagingTypeId')::uuid
      as packaging_type_id,
    (order_row.value -> 'packages' -> 0 ->> 'quantity')::integer
      as package_quantity
  into v_latest
  from public.dispatch_batches batch
  cross join lateral jsonb_array_elements(batch.orders) as order_row(value)
  where batch.status = 'CONFIRMED'
    and order_row.value ->> 'compositionKey' = p_composition_key
    and jsonb_typeof(order_row.value -> 'items') = 'array'
    and jsonb_typeof(order_row.value -> 'packages') = 'array'
    and jsonb_array_length(order_row.value -> 'packages') = 1
    and coalesce(
      order_row.value -> 'packages' -> 0 ->> 'packagingTypeId',
      ''
    ) ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
    and coalesce(
      order_row.value -> 'packages' -> 0 ->> 'quantity',
      ''
    ) ~ '^[1-9][0-9]{0,6}$'
  order by batch.confirmed_at desc, batch.id desc
  limit 1;

  if not found then
    delete from public.dispatch_packaging_preferences preference
    where preference.composition_key = p_composition_key;
    return;
  end if;

  select count(*)::integer
  into v_count
  from public.dispatch_batches batch
  cross join lateral jsonb_array_elements(batch.orders) as order_row(value)
  where batch.status = 'CONFIRMED'
    and order_row.value ->> 'compositionKey' = p_composition_key
    and jsonb_typeof(order_row.value -> 'packages') = 'array'
    and jsonb_array_length(order_row.value -> 'packages') = 1;

  insert into public.dispatch_packaging_preferences (
    composition_key,
    composition,
    packaging_type_id,
    package_quantity,
    confirmation_count,
    last_confirmed_batch_id,
    last_actor_email,
    last_confirmed_at,
    created_at,
    updated_at
  ) values (
    p_composition_key,
    coalesce(v_latest.composition, '[]'::jsonb),
    v_latest.packaging_type_id,
    v_latest.package_quantity,
    greatest(v_count, 1),
    v_latest.batch_id,
    v_latest.actor_email,
    v_latest.confirmed_at,
    clock_timestamp(),
    clock_timestamp()
  )
  on conflict (composition_key) do update
  set composition = excluded.composition,
      packaging_type_id = excluded.packaging_type_id,
      package_quantity = excluded.package_quantity,
      confirmation_count = excluded.confirmation_count,
      last_confirmed_batch_id = excluded.last_confirmed_batch_id,
      last_actor_email = excluded.last_actor_email,
      last_confirmed_at = excluded.last_confirmed_at,
      updated_at = clock_timestamp();
end;
$$;

create or replace function public.sync_dispatch_packaging_preferences()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  v_key text;
begin
  for v_key in
    select distinct order_row.value ->> 'compositionKey'
    from jsonb_array_elements(new.orders) as order_row(value)
    where coalesce(order_row.value ->> 'compositionKey', '')
      ~ '^[a-f0-9]{64}$'
  loop
    perform public.refresh_dispatch_packaging_preference(v_key);
  end loop;
  return new;
end;
$$;

drop trigger if exists dispatch_packaging_preferences_sync
  on public.dispatch_batches;
create trigger dispatch_packaging_preferences_sync
after insert or update of status on public.dispatch_batches
for each row execute function public.sync_dispatch_packaging_preferences();

revoke all on function public.refresh_dispatch_packaging_preference(text)
  from public, anon, authenticated;
grant execute on function public.refresh_dispatch_packaging_preference(text)
  to service_role;
revoke all on function public.sync_dispatch_packaging_preferences()
  from public, anon, authenticated;

comment on table public.dispatch_packaging_preferences is
  'Latest confirmed real packaging choice for each normalized dispatch composition.';
comment on function public.refresh_dispatch_packaging_preference(text) is
  'Rebuilds one adaptive packaging preference from confirmed dispatch history.';

commit;
