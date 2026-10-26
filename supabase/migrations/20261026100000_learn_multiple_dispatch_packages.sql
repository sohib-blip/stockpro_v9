begin;

-- An order can now be packed in several packages (e.g. 1 Normal Box C +
-- 2 Radius Box Small). The learned preference keeps the whole combination;
-- packaging_type_id / package_quantity keep the first package for older code.
alter table public.dispatch_packaging_preferences
  add column if not exists packages jsonb;

update public.dispatch_packaging_preferences preference
set packages = jsonb_build_array(
  jsonb_build_object(
    'packagingTypeId', preference.packaging_type_id::text,
    'quantity', preference.package_quantity
  )
)
where preference.packages is null;

alter table public.dispatch_packaging_preferences
  alter column packages set not null;

alter table public.dispatch_packaging_preferences
  drop constraint if exists dispatch_packaging_preferences_packages_check;
alter table public.dispatch_packaging_preferences
  add constraint dispatch_packaging_preferences_packages_check check (
    jsonb_typeof(packages) = 'array'
    and jsonb_array_length(packages) between 1 and 20
  );

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

  -- Latest confirmed order with this composition and 1 to 20 valid packages.
  select
    batch.id as batch_id,
    batch.actor_email,
    batch.confirmed_at,
    order_row.value -> 'items' as composition,
    (
      select jsonb_agg(
        jsonb_build_object(
          'packagingTypeId', package_row.value ->> 'packagingTypeId',
          'quantity', (package_row.value ->> 'quantity')::integer
        )
        order by package_row.ordinality
      )
      from jsonb_array_elements(order_row.value -> 'packages')
        with ordinality as package_row(value, ordinality)
    ) as packages
  into v_latest
  from public.dispatch_batches batch
  cross join lateral jsonb_array_elements(batch.orders) as order_row(value)
  where batch.status = 'CONFIRMED'
    and order_row.value ->> 'compositionKey' = p_composition_key
    and jsonb_typeof(order_row.value -> 'items') = 'array'
    and jsonb_typeof(order_row.value -> 'packages') = 'array'
    and jsonb_array_length(order_row.value -> 'packages') between 1 and 20
    and not exists (
      select 1
      from jsonb_array_elements(order_row.value -> 'packages') as package_row(value)
      where coalesce(package_row.value ->> 'packagingTypeId', '')
          !~ '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
        or coalesce(package_row.value ->> 'quantity', '') !~ '^[1-9][0-9]{0,6}$'
    )
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
    and jsonb_array_length(order_row.value -> 'packages') between 1 and 20;

  insert into public.dispatch_packaging_preferences (
    composition_key,
    composition,
    packaging_type_id,
    package_quantity,
    packages,
    confirmation_count,
    last_confirmed_batch_id,
    last_actor_email,
    last_confirmed_at,
    created_at,
    updated_at
  ) values (
    p_composition_key,
    coalesce(v_latest.composition, '[]'::jsonb),
    (v_latest.packages -> 0 ->> 'packagingTypeId')::uuid,
    (v_latest.packages -> 0 ->> 'quantity')::integer,
    v_latest.packages,
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
      packages = excluded.packages,
      confirmation_count = excluded.confirmation_count,
      last_confirmed_batch_id = excluded.last_confirmed_batch_id,
      last_actor_email = excluded.last_actor_email,
      last_confirmed_at = excluded.last_confirmed_at,
      updated_at = clock_timestamp();
end;
$$;

revoke all on function public.refresh_dispatch_packaging_preference(text)
  from public, anon, authenticated;
grant execute on function public.refresh_dispatch_packaging_preference(text)
  to service_role;

commit;
