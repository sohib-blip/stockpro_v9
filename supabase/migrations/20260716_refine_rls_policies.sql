begin;

-- Helper functions used inside policies should not be exposed as public RPCs.
create schema if not exists private;
revoke all privileges on schema private from public, anon;
revoke create on schema private from authenticated;
grant usage on schema private to authenticated, service_role;

alter function public.is_admin(uuid) set schema private;
revoke all privileges on function private.is_admin(uuid)
  from public, anon, authenticated;
grant execute on function private.is_admin(uuid)
  to authenticated, service_role;

-- Keep shared-warehouse writes available to signed-in users while requiring a
-- real JWT identity instead of an unconditional expression.
drop policy if exists bins_authenticated_all on public.bins;
create policy bins_authenticated_all
on public.bins
for all
to authenticated
using ((select auth.uid()) is not null)
with check ((select auth.uid()) is not null);

drop policy if exists boxes_authenticated_update on public.boxes;
create policy boxes_authenticated_update
on public.boxes
for update
to authenticated
using ((select auth.uid()) is not null)
with check ((select auth.uid()) is not null);

drop policy if exists thresholds_authenticated_all
on public.device_thresholds;
create policy thresholds_authenticated_all
on public.device_thresholds
for all
to authenticated
using ((select auth.uid()) is not null)
with check ((select auth.uid()) is not null);

commit;
