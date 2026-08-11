begin;

-- The application migrated inventory from devices to bins, but movements
-- still referenced the legacy devices table and two duplicate triggers tried
-- to read the removed boxes.device_id column.
drop trigger if exists trg_fill_device_from_box on public.movements;
drop trigger if exists trigger_fill_device_from_box on public.movements;
drop trigger if exists trg_update_device_stock on public.movements;

alter table public.movements
  drop constraint if exists movements_device_id_fkey;

alter table public.movements
  drop constraint if exists movements_bin_id_fkey;

alter table public.movements
  add constraint movements_bin_id_fkey
  foreign key (device_id)
  references public.bins(id)
  on update cascade
  on delete restrict;

create or replace function public.fill_device_from_box()
returns trigger
language plpgsql
as $$
begin
  if new.device_id is null and new.box_id is not null then
    select bin_id
    into new.device_id
    from public.boxes
    where id = new.box_id;
  end if;

  return new;
end;
$$;

create trigger trg_fill_device_from_box
before insert on public.movements
for each row
execute function public.fill_device_from_box();

comment on column public.movements.device_id is
  'Legacy column name: stores public.bins.id for inventory movements.';

commit;
