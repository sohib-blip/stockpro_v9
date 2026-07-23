begin;

-- capability: bins.read
-- capability: bins.manage -> can_bins
drop policy if exists bins_authenticated_all on public.bins;
drop policy if exists bins_authenticated_read on public.bins;
drop policy if exists bins_permission_write on public.bins;

create policy bins_authenticated_read
on public.bins
for select
to authenticated
using (private.has_app_role((select auth.uid())));

create policy bins_permission_write
on public.bins
for all
to authenticated
using (private.has_permission((select auth.uid()), 'can_bins'))
with check (private.has_permission((select auth.uid()), 'can_bins'));

grant select, insert, update, delete on table public.bins to authenticated;

-- capabilities: inventory.read and movement.read are server-only. Remove the
-- ambient browser grants and all known broad read-policy variants.
revoke select on table public.items from authenticated;
drop policy if exists items_authenticated_read on public.items;
drop policy if exists items_read_all on public.items;
drop policy if exists dev_all_items on public.items;

revoke select on table public.movements from authenticated;
drop policy if exists movements_authenticated_read on public.movements;
drop policy if exists movements_read_all on public.movements;

-- Defense in depth: the raw export view is available only through guarded
-- server handlers using the service role.
revoke select on table public.stock_export_view from authenticated;

-- capability: inventory.item-match -> can_inbound
-- This is the only browser-visible IMEI read. It returns no metadata and only
-- exact matches from a small caller-supplied set.
drop function if exists public.check_existing_imeis(text[]);
create function public.check_existing_imeis(requested_imeis text[])
returns table(imei text)
language plpgsql
stable
security definer
set search_path = pg_catalog, public, private
as $$
begin
  if (select auth.uid()) is null
     or not private.has_permission((select auth.uid()), 'can_inbound') then
    raise exception 'insufficient privilege'
      using errcode = '42501';
  end if;

  if requested_imeis is null
     or cardinality(requested_imeis) not between 1 and 200 then
    raise exception 'requested_imeis must contain between 1 and 200 values'
      using errcode = '22023';
  end if;

  return query
    select distinct i.imei::text
    from public.items i
    where i.imei = any(requested_imeis);
end;
$$;

revoke all privileges on function public.check_existing_imeis(text[])
  from public, anon, authenticated;
grant execute on function public.check_existing_imeis(text[]) to authenticated;

comment on function public.check_existing_imeis(text[]) is
  'Bounded exact-match IMEI lookup for users with can_inbound.';

commit;
