-- The MatrixIQ bin can also be named "Matrix TagiQ" (case, spaces and
-- dashes ignored), like lib/device-serials.ts. confirm_inbound_batch and
-- confirm_outbound_batch already use this function, so only it changes.

begin;

create or replace function public.stockpro_device_id_pattern(p_bin_name text)
returns text
language sql
immutable
set search_path = pg_catalog
as $$
  select case
    when upper(regexp_replace(coalesce(p_bin_name, ''), '[^A-Za-z0-9]', '', 'g')) like '%MATRIXIQ%'
      or upper(regexp_replace(coalesce(p_bin_name, ''), '[^A-Za-z0-9]', '', 'g')) like '%MATRIXTAGIQ%'
      then '^[0-9]{12}$'
    else '^[0-9]{15}$'
  end
$$;

revoke all on function public.stockpro_device_id_pattern(text) from public, anon, authenticated;
grant execute on function public.stockpro_device_id_pattern(text) to service_role;

commit;
