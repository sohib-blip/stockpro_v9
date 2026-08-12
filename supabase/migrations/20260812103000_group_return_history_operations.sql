begin;

-- Return history is presented as one row per operator operation. The detail
-- rows remain in return_records and are loaded only when an operation opens.
create or replace function public.get_return_operation_history_page(
  p_cursor_created_at timestamptz default null,
  p_cursor_history_key text default null,
  p_limit integer default 51,
  p_search text default null,
  p_month date default null,
  p_return_status text default null,
  p_courier text default null,
  p_country_code text default null
)
returns table (
  history_key text,
  operation_id uuid,
  created_at timestamptz,
  actor text,
  return_ref text,
  return_type text,
  return_reason text,
  item_count bigint,
  customer text,
  sur_id text,
  courier text,
  country_code text,
  return_status text,
  device_summary text,
  device_count bigint,
  stock_action text
)
language sql
security definer
set search_path = pg_catalog, public
as $$
  with resolved_records as (
    select
      r.*,
      coalesce(r.operation_id::text, 'record:' || r.id::text) as operation_key,
      coalesce(nullif(btrim(r.reported_device), ''), b.name, '') as resolved_device
    from public.return_records r
    left join public.bins b on b.id = r.device_id
  ), operations as (
    select
      rr.operation_key,
      max(rr.operation_id::text)::uuid as operation_id,
      max(rr.created_at) as created_at,
      max(rr.actor) as actor,
      max(rr.return_ref) as return_ref,
      max(rr.return_type) as return_type,
      max(rr.return_reason) as return_reason,
      count(*)::bigint as item_count,
      max(rr.customer) as customer,
      max(rr.sur_id) as sur_id,
      max(rr.courier) as courier,
      max(rr.country_code) as country_code,
      max(rr.return_status) as return_status,
      case
        when count(distinct nullif(rr.resolved_device, '')) = 0 then ''
        when count(distinct nullif(rr.resolved_device, '')) = 1
          then max(rr.resolved_device)
        else count(distinct nullif(rr.resolved_device, ''))::text || ' devices'
      end as device_summary,
      count(distinct nullif(rr.resolved_device, ''))::bigint as device_count,
      case
        when bool_and(rr.stock_action = 'added_to_stock') then 'added_to_stock'
        when bool_and(rr.stock_action = 'no_stock_change') then 'no_stock_change'
        else 'mixed'
      end as stock_action
    from resolved_records rr
    group by rr.operation_key
  )
  select
    operation.operation_key,
    operation.operation_id,
    operation.created_at,
    operation.actor,
    operation.return_ref,
    operation.return_type,
    operation.return_reason,
    operation.item_count,
    operation.customer,
    operation.sur_id,
    operation.courier,
    operation.country_code,
    operation.return_status,
    operation.device_summary,
    operation.device_count,
    operation.stock_action
  from operations operation
  where (
    (
      p_cursor_created_at is null
      and p_cursor_history_key is null
    ) or (
      p_cursor_created_at is not null
      and p_cursor_history_key is not null
      and (operation.created_at, operation.operation_key)
        < (p_cursor_created_at, p_cursor_history_key)
    )
  )
  and (
    nullif(btrim(coalesce(p_search, '')), '') is null
    or exists (
      select 1
      from resolved_records matching
      where matching.operation_key = operation.operation_key
        and lower(concat_ws(
          ' ',
          matching.return_ref,
          matching.sur_id,
          matching.customer,
          matching.imei,
          matching.actor,
          matching.resolved_device
        )) like '%' || lower(btrim(p_search)) || '%'
    )
  )
  and (
    p_month is null
    or (
      operation.created_at >=
        (p_month::timestamp at time zone 'Europe/Brussels')
      and operation.created_at <
        ((p_month + interval '1 month')::timestamp at time zone 'Europe/Brussels')
    )
  )
  and (
    nullif(btrim(coalesce(p_return_status, '')), '') is null
    or operation.return_status = lower(btrim(p_return_status))
  )
  and (
    nullif(btrim(coalesce(p_courier, '')), '') is null
    or operation.courier = upper(btrim(p_courier))
  )
  and (
    nullif(btrim(coalesce(p_country_code, '')), '') is null
    or operation.country_code = upper(btrim(p_country_code))
  )
  order by operation.created_at desc, operation.operation_key desc
  limit least(greatest(coalesce(p_limit, 51), 1), 51);
$$;

revoke all on function public.get_return_operation_history_page(
  timestamptz, text, integer, text, date, text, text, text
) from public, anon, authenticated;
grant execute on function public.get_return_operation_history_page(
  timestamptz, text, integer, text, date, text, text, text
) to service_role;

comment on function public.get_return_operation_history_page(
  timestamptz, text, integer, text, date, text, text, text
) is
  'Returns one bounded, filterable history row per return operation.';

commit;
