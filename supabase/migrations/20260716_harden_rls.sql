begin;

-- Baseline: public visitors must never reach application data directly.
revoke create on schema public from public, anon, authenticated;
grant usage on schema public to anon, authenticated, service_role;

revoke all privileges on all tables in schema public from anon, authenticated;
revoke all privileges on all sequences in schema public from anon, authenticated;
revoke all privileges on all functions in schema public from public, anon, authenticated;

-- Prevent future public objects from silently inheriting open privileges.
alter default privileges in schema public
  revoke all privileges on tables from anon, authenticated;
alter default privileges in schema public
  revoke all privileges on sequences from anon, authenticated;
alter default privileges in schema public
  revoke execute on functions from public, anon, authenticated;
alter default privileges in schema public
  grant execute on functions to service_role;

-- Remove the old development policies before installing the audited set.
drop policy if exists "alertlog admin read" on public.alert_log;
drop policy if exists "subscribers admin" on public.alert_subscribers;
drop policy if exists audit_admin_read on public.audit_events;
drop policy if exists audit_insert_ops on public.audit_events;
drop policy if exists dev_all_audit_events on public.audit_events;
drop policy if exists "read thresholds" on public.device_thresholds;
drop policy if exists "write thresholds admin" on public.device_thresholds;
drop policy if exists dev_all_devices on public.devices;
drop policy if exists devices_admin_delete on public.devices;
drop policy if exists devices_admin_update on public.devices;
drop policy if exists devices_admin_write on public.devices;
drop policy if exists devices_insert_auth on public.devices;
drop policy if exists devices_read_all on public.devices;
drop policy if exists devices_select_auth on public.devices;
drop policy if exists devices_update_auth on public.devices;
drop policy if exists dev_all_items on public.items;
drop policy if exists items_insert_inbound on public.items;
drop policy if exists items_read_all on public.items;
drop policy if exists items_update_inbound_admin on public.items;
drop policy if exists movements_insert_ops on public.movements;
drop policy if exists movements_read_all on public.movements;
drop policy if exists dev_all_profiles on public.profiles;
drop policy if exists profiles_select_own on public.profiles;
drop policy if exists profiles_update_own on public.profiles;
drop policy if exists dev_all_user_roles on public.user_roles;
drop policy if exists roles_admin_all on public.user_roles;

-- This overload referenced the removed outbound_batches table and ran as the
-- database owner. The application uses the six-argument service-only RPC.
drop function if exists public.confirm_outbound_batch(
  text[], text, uuid, text, text
);

-- The old permission helper referenced columns that no longer exist. The
-- current baseline uses explicit policies and keeps role checks isolated.
drop function if exists public.has_perm(uuid, text);

create or replace function public.is_admin(uid uuid)
returns boolean
language sql
stable
security definer
set search_path = pg_catalog, public
as $$
  select exists (
    select 1
    from public.user_roles r
    where r.user_id = uid
      and r.role = 'admin'
  );
$$;

alter function public.check_stock_before_out()
  set search_path = pg_catalog, public;
alter function public.confirm_outbound_batch(
  text[], text, uuid, text, text, uuid
) security invoker;
alter function public.confirm_outbound_batch(
  text[], text, uuid, text, text, uuid
) set search_path = pg_catalog, public;
alter function public.fill_device_from_box()
  set search_path = pg_catalog, public;
alter function public.refresh_box_qr_payload(uuid)
  set search_path = pg_catalog, public;
alter function public.set_updated_at()
  set search_path = pg_catalog, public;
alter function public.trg_items_refresh_box_qr()
  set search_path = pg_catalog, public;

-- Functions are private by default. Only the role check is callable by a
-- signed-in user; inventory mutation RPCs remain service-role only.
grant execute on all functions in schema public to service_role;
grant execute on function public.is_admin(uuid) to authenticated;
revoke all privileges on function public.confirm_outbound_batch(
  text[], text, uuid, text, text, uuid
) from public, anon, authenticated;
grant execute on function public.confirm_outbound_batch(
  text[], text, uuid, text, text, uuid
) to service_role;

-- Every application table is protected. Tables without a policy are
-- intentionally backend-only; the service role bypasses RLS in API routes.
alter table public.accessory_bins enable row level security;
alter table public.accessory_movements enable row level security;
alter table public.alert_log enable row level security;
alter table public.alert_subscribers enable row level security;
alter table public.audit_events enable row level security;
alter table public.bins enable row level security;
alter table public.boxes enable row level security;
alter table public.device_accessory_templates enable row level security;
alter table public.device_thresholds enable row level security;
alter table public.devices enable row level security;
alter table public.inbound_batches enable row level security;
alter table public.items enable row level security;
alter table public.movements enable row level security;
alter table public.nrd_time_logs enable row level security;
alter table public.profiles enable row level security;
alter table public.supplies enable row level security;
alter table public.supply_items enable row level security;
alter table public.supply_status_history enable row level security;
alter table public.user_permissions enable row level security;
alter table public.user_roles enable row level security;

-- Shared warehouse catalogue: signed-in users keep the access used by the UI.
create policy bins_authenticated_all
on public.bins
for all
to authenticated
using (true)
with check (true);

create policy boxes_authenticated_read
on public.boxes
for select
to authenticated
using (true);

create policy boxes_authenticated_update
on public.boxes
for update
to authenticated
using (true)
with check (true);

create policy thresholds_authenticated_all
on public.device_thresholds
for all
to authenticated
using (true)
with check (true);

create policy devices_authenticated_read
on public.devices
for select
to authenticated
using (true);

create policy items_authenticated_read
on public.items
for select
to authenticated
using (true);

create policy movements_authenticated_read
on public.movements
for select
to authenticated
using (true);

-- Session metadata is private to its owner.
create policy profiles_select_own
on public.profiles
for select
to authenticated
using ((select auth.uid()) = user_id);

create policy profiles_insert_own
on public.profiles
for insert
to authenticated
with check ((select auth.uid()) = user_id);

create policy profiles_update_own
on public.profiles
for update
to authenticated
using ((select auth.uid()) = user_id)
with check ((select auth.uid()) = user_id);

create policy user_roles_select_own
on public.user_roles
for select
to authenticated
using ((select auth.uid()) = user_id);

create policy user_permissions_select_own
on public.user_permissions
for select
to authenticated
using ((select auth.uid()) = user_id);

-- Administrative data stays invisible unless a role is explicitly assigned.
create policy alert_log_admin_read
on public.alert_log
for select
to authenticated
using (public.is_admin((select auth.uid())));

create policy alert_subscribers_admin_all
on public.alert_subscribers
for all
to authenticated
using (public.is_admin((select auth.uid())))
with check (public.is_admin((select auth.uid())));

create policy audit_events_admin_read
on public.audit_events
for select
to authenticated
using (public.is_admin((select auth.uid())));

-- Re-grant only the direct browser operations present in the application.
grant select, insert, update on table public.profiles to authenticated;
grant select on table public.user_roles to authenticated;
grant select on table public.user_permissions to authenticated;
grant select, insert, update, delete on table public.bins to authenticated;
grant select on table public.boxes to authenticated;
grant update (floor) on table public.boxes to authenticated;
grant select, insert, update, delete on table public.device_thresholds
  to authenticated;
grant select on table public.devices to authenticated;
grant select on table public.items to authenticated;
grant select on table public.movements to authenticated;
grant usage, select on all sequences in schema public to authenticated;

-- Views must apply the caller's RLS instead of the view owner's privileges.
alter view public.dashboard_activity set (security_invoker = true);
alter view public.dashboard_bins_view set (security_invoker = true);
alter view public.dashboard_device_flow set (security_invoker = true);
alter view public.dashboard_drilldown_view set (security_invoker = true);
alter view public.dashboard_floors_view set (security_invoker = true);
alter view public.inbound_history_view set (security_invoker = true);
alter view public.stock_export_view set (security_invoker = true);

-- movements.device_id now stores bins.id, so this active dashboard view must
-- use bins as well as run with the invoker's permissions.
create or replace view public.dashboard_sales_month
with (security_invoker = true)
as
select
  b.name as device,
  sum(m.qty)::integer as total_out
from public.movements m
join public.bins b on b.id = m.device_id
where m.type = 'OUT'
  and date_trunc('month', m.created_at) = date_trunc('month', now())
group by b.name
order by sum(m.qty)::integer desc;

commit;
