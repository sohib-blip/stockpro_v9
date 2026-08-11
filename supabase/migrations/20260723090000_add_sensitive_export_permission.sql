begin;

-- capability: inventory.export.raw -> can_inventory_export
alter table public.user_permissions
  add column if not exists can_inventory_export boolean not null default false;

-- Existing operators previously had access through can_dashboard. Preserve
-- their operational workflow while removing that access from read-only users.
update public.user_permissions p
set can_inventory_export = true
from public.user_roles r
where r.user_id = p.user_id
  and r.role in ('admin', 'operator');

create or replace function private.has_permission(uid uuid, permission_name text)
returns boolean
language sql
stable
security definer
set search_path = pg_catalog, public, private
as $$
  select private.is_admin(uid) or exists (
    select 1
    from public.user_permissions p
    where p.user_id = uid
      and case permission_name
        when 'can_dashboard' then p.can_dashboard
        when 'can_inventory_export' then p.can_inventory_export
        when 'can_inbound' then p.can_inbound
        when 'can_outbound' then p.can_outbound
        when 'can_returns' then p.can_returns
        when 'can_transfer' then p.can_transfer
        when 'can_labels' then p.can_labels
        when 'can_bins' then p.can_bins
        when 'can_accessories' then p.can_accessories
        when 'can_supply' then p.can_supply
        when 'can_nrd' then p.can_nrd
        when 'can_admin' then p.can_admin
        else false
      end
  );
$$;

revoke all privileges on function private.has_permission(uuid, text)
  from public, anon, authenticated;
grant execute on function private.has_permission(uuid, text)
  to authenticated, service_role;

comment on column public.user_permissions.can_inventory_export is
  'Allows global exports containing raw IMEIs and warehouse locations.';

commit;
