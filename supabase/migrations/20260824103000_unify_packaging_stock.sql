begin;

alter table public.packaging_types
  add column if not exists legacy_accessory_bin_id uuid
    references public.accessory_bins(id) on delete set null;

create unique index if not exists packaging_types_legacy_accessory_unique
  on public.packaging_types (legacy_accessory_bin_id)
  where legacy_accessory_bin_id is not null;

-- The original application stored boxes and envelopes as accessory bins. Link
-- only rows whose name contains an exact packaging code, so sleeves and other
-- non-shipping accessories remain independent.
with ranked_matches as (
  select
    packaging.id as packaging_id,
    accessory.id as accessory_id,
    greatest(0, coalesce(accessory.current_stock, 0)) as current_stock,
    greatest(0, coalesce(accessory.minimum_stock, 0)) as minimum_stock,
    row_number() over (
      partition by packaging.id
      order by accessory.active desc, accessory.current_stock desc, accessory.id
    ) as match_rank
  from public.packaging_types packaging
  join public.accessory_bins accessory
    on accessory.category = 'Packages'
   and position(upper(packaging.code) in upper(accessory.name)) > 0
)
update public.packaging_types packaging
set legacy_accessory_bin_id = matched.accessory_id,
    on_hand_stock = case
      when packaging.on_hand_stock = 0 and packaging.reserved_stock = 0
        then matched.current_stock
      else packaging.on_hand_stock
    end,
    minimum_stock = case
      when packaging.minimum_stock = 0 then matched.minimum_stock
      else packaging.minimum_stock
    end,
    updated_at = clock_timestamp()
from ranked_matches matched
where matched.packaging_id = packaging.id
  and matched.match_rank = 1
  and (
    packaging.legacy_accessory_bin_id is distinct from matched.accessory_id
    or (packaging.on_hand_stock = 0 and matched.current_stock > 0)
    or (packaging.minimum_stock = 0 and matched.minimum_stock > 0)
  );

create or replace function public.sync_packaging_from_legacy_accessory()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
begin
  update public.packaging_types packaging
  set on_hand_stock = greatest(
        coalesce(new.current_stock, 0),
        packaging.reserved_stock
      ),
      minimum_stock = greatest(0, coalesce(new.minimum_stock, 0)),
      active = coalesce(new.active, true),
      updated_at = clock_timestamp()
  where packaging.legacy_accessory_bin_id = new.id
    and (
      packaging.on_hand_stock is distinct from greatest(
        coalesce(new.current_stock, 0),
        packaging.reserved_stock
      )
      or packaging.minimum_stock is distinct from greatest(
        0,
        coalesce(new.minimum_stock, 0)
      )
      or packaging.active is distinct from coalesce(new.active, true)
    );

  return new;
end;
$$;

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
      active = new.active
  where accessory.id = new.legacy_accessory_bin_id
    and (
      accessory.current_stock is distinct from new.on_hand_stock
      or accessory.minimum_stock is distinct from new.minimum_stock
      or accessory.active is distinct from new.active
    );

  return new;
end;
$$;

drop trigger if exists accessory_bins_sync_packaging_stock
  on public.accessory_bins;
create trigger accessory_bins_sync_packaging_stock
after update of current_stock, minimum_stock, active
on public.accessory_bins
for each row
execute function public.sync_packaging_from_legacy_accessory();

drop trigger if exists packaging_types_sync_legacy_stock
  on public.packaging_types;
create trigger packaging_types_sync_legacy_stock
after update of on_hand_stock, minimum_stock, active
on public.packaging_types
for each row
execute function public.sync_legacy_accessory_from_packaging();

revoke all on function public.sync_packaging_from_legacy_accessory()
  from public, anon, authenticated;
revoke all on function public.sync_legacy_accessory_from_packaging()
  from public, anon, authenticated;

comment on column public.packaging_types.legacy_accessory_bin_id is
  'Compatibility link to the historical Packages accessory row. Stock changes are synchronized both ways during migration to packaging inventory.';

commit;
