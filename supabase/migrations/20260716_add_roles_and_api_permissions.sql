begin;

alter table public.user_permissions
  add column if not exists can_returns boolean not null default false,
  add column if not exists can_accessories boolean not null default false,
  add column if not exists can_supply boolean not null default false,
  add column if not exists can_nrd boolean not null default false,
  add column if not exists can_alerts boolean not null default false;

create unique index if not exists user_roles_user_id_uidx
  on public.user_roles (user_id);
create unique index if not exists user_permissions_user_id_uidx
  on public.user_permissions (user_id);

alter table public.user_roles
  drop constraint if exists user_roles_role_check;
alter table public.user_roles
  add constraint user_roles_role_check
  check (role in ('admin', 'operator', 'viewer'));

create or replace function private.has_app_role(uid uuid)
returns boolean
language sql
stable
security definer
set search_path = pg_catalog, public, private
as $$
  select exists (
    select 1
    from public.user_roles r
    where r.user_id = uid
      and r.role in ('admin', 'operator', 'viewer')
  );
$$;

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
        when 'can_alerts' then p.can_alerts
        when 'can_admin' then p.can_admin
        else false
      end
  );
$$;

revoke all privileges on function private.has_app_role(uuid)
  from public, anon, authenticated;
revoke all privileges on function private.has_permission(uuid, text)
  from public, anon, authenticated;
grant execute on function private.has_app_role(uuid) to authenticated, service_role;
grant execute on function private.has_permission(uuid, text) to authenticated, service_role;

drop policy if exists bins_authenticated_all on public.bins;
create policy bins_authenticated_read
on public.bins for select to authenticated
using (private.has_app_role((select auth.uid())));
create policy bins_permission_write
on public.bins for all to authenticated
using (private.has_permission((select auth.uid()), 'can_bins'))
with check (private.has_permission((select auth.uid()), 'can_bins'));

drop policy if exists boxes_authenticated_read on public.boxes;
drop policy if exists boxes_authenticated_update on public.boxes;
create policy boxes_authenticated_read
on public.boxes for select to authenticated
using (private.has_app_role((select auth.uid())));
create policy boxes_permission_update
on public.boxes for update to authenticated
using (
  private.has_permission((select auth.uid()), 'can_transfer') or
  private.has_permission((select auth.uid()), 'can_bins')
)
with check (
  private.has_permission((select auth.uid()), 'can_transfer') or
  private.has_permission((select auth.uid()), 'can_bins')
);

drop policy if exists thresholds_authenticated_all on public.device_thresholds;
create policy thresholds_authenticated_read
on public.device_thresholds for select to authenticated
using (private.has_app_role((select auth.uid())));
create policy thresholds_permission_write
on public.device_thresholds for all to authenticated
using (private.has_permission((select auth.uid()), 'can_alerts'))
with check (private.has_permission((select auth.uid()), 'can_alerts'));

drop policy if exists devices_authenticated_read on public.devices;
create policy devices_authenticated_read
on public.devices for select to authenticated
using (private.has_app_role((select auth.uid())));

drop policy if exists items_authenticated_read on public.items;
create policy items_authenticated_read
on public.items for select to authenticated
using (private.has_app_role((select auth.uid())));

drop policy if exists movements_authenticated_read on public.movements;
create policy movements_authenticated_read
on public.movements for select to authenticated
using (private.has_app_role((select auth.uid())));

commit;
