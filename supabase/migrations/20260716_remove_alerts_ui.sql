begin;

-- The standalone Alerts page duplicated the Dashboard min-stock controls.
-- Keep automatic emails, but make Dashboard/bins the single source of truth.
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

drop policy if exists thresholds_permission_write
  on public.device_thresholds;
revoke insert, update, delete on table public.device_thresholds
  from authenticated;

alter table public.user_permissions
  drop column if exists can_alerts;

commit;
