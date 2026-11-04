-- Device thresholds: read for StockPro users only, no writes from the browser.
--
-- 20260716_harden_rls.sql and 20260716_refine_rls_policies.sql (re)create
-- thresholds_authenticated_all, which lets any signed-in account read and,
-- when the table grants allow it, change every threshold. The application code
-- does not read or write public.device_thresholds; only the server
-- (service_role, which bypasses RLS) may change it.
--
-- Idempotent: on a database that is already restricted nothing changes.

begin;

drop policy if exists thresholds_authenticated_all on public.device_thresholds;
drop policy if exists thresholds_permission_write on public.device_thresholds;

drop policy if exists thresholds_authenticated_read on public.device_thresholds;
create policy thresholds_authenticated_read
on public.device_thresholds
for select
to authenticated
using (private.has_app_role((select auth.uid())));

alter table public.device_thresholds enable row level security;

revoke all privileges on table public.device_thresholds from public, anon;
revoke insert, update, delete, truncate, references, trigger
  on table public.device_thresholds from authenticated;
grant select on table public.device_thresholds to authenticated;

commit;
