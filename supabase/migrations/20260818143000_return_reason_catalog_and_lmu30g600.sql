begin;

-- Return type is no longer an operator decision. Keep the legacy database
-- value internal so existing movement/audit structures remain compatible,
-- while exposing only the Control return-reason catalogue to the application.
create or replace function public.confirm_return_batch_v3(
  p_operation_id uuid,
  p_actor_id uuid,
  p_actor text,
  p_item_ids uuid[],
  p_unknown_imeis text[],
  p_target_box text,
  p_target_floor text,
  p_return_ref text,
  p_return_reason text,
  p_return_status text,
  p_courier text,
  p_country_code text,
  p_customer text,
  p_sur_id text,
  p_reported_device text
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  v_reason text := btrim(coalesce(p_return_reason, ''));
  v_forwarded_device text := p_reported_device;
  v_uses_lmu30g600_alias boolean := false;
  v_result jsonb;
begin
  if v_reason not in (
    'Returned device',
    'Other',
    'Fleet reductions/too many devices',
    'Replacement (wrong device/swap out)',
    'Service/Installation issues',
    'Moving to competitor/price',
    'Don''t see value',
    'Need more functionality',
    'Account Transfer',
    'Device Transfer',
    'Business Closure',
    'Returned to Sender',
    'Credit Stop – Fraud',
    'Credit Stop - Insolvency/administration',
    'Credit Stop – Non payer/exhausted all recoveries'
  ) then
    raise exception 'RETURN_REASON_INVALID' using errcode = '22023';
  end if;

  -- confirm_return_batch_v2 predates LMU30G600. If it has not been configured
  -- as a canonical bin yet, use an existing supported model only while the
  -- transaction runs, then immediately persist and return the requested model.
  v_uses_lmu30g600_alias :=
    lower(btrim(coalesce(p_return_status, ''))) <> 'available'
    and upper(btrim(coalesce(p_reported_device, ''))) = 'LMU30G600'
    and not exists (
      select 1
      from public.bins b
      where lower(btrim(b.name)) = 'lmu30g600'
    );

  if v_uses_lmu30g600_alias then
    v_forwarded_device := 'LMU2640';
  end if;

  select public.confirm_return_batch_v2(
    p_operation_id,
    p_actor_id,
    p_actor,
    p_item_ids,
    p_target_box,
    p_target_floor,
    p_return_ref,
    'technical_stop',
    v_reason,
    p_return_status,
    p_courier,
    p_country_code,
    p_customer,
    p_sur_id,
    v_forwarded_device,
    p_unknown_imeis
  )
  into v_result;

  if v_uses_lmu30g600_alias then
    update public.return_records r
    set reported_device = 'LMU30G600'
    where r.operation_id = p_operation_id;

    v_result := jsonb_set(
      v_result,
      '{reported_device}',
      to_jsonb('LMU30G600'::text),
      true
    );

    update public.inventory_command_receipts receipt
    set result = v_result
    where receipt.operation_id = p_operation_id
      and receipt.command_type = 'return';
  end if;

  return v_result;
end;
$$;

revoke all on function public.confirm_return_batch_v3(
  uuid, uuid, text, uuid[], text[], text, text, text, text, text, text,
  text, text, text, text
) from public, anon, authenticated;
grant execute on function public.confirm_return_batch_v3(
  uuid, uuid, text, uuid[], text[], text, text, text, text, text, text,
  text, text, text, text
) to service_role;

comment on function public.confirm_return_batch_v3(
  uuid, uuid, text, uuid[], text[], text, text, text, text, text, text,
  text, text, text, text
) is
  'Confirms customer returns with the Control reason catalogue and no operator-facing return type.';

-- Preserve the existing atomic claim/reset workflow while returning the
-- reason required by the new Control bulk workbook.
create or replace function public.claim_return_template_export_batch_v2(
  p_batch_id uuid,
  p_actor_id uuid,
  p_actor text,
  p_limit integer default 50000
)
returns table (
  id uuid,
  operation_id uuid,
  created_at timestamptz,
  return_status text,
  return_reason text,
  imei text
)
language sql
security definer
set search_path = pg_catalog, public
as $$
  select
    claimed.id,
    claimed.operation_id,
    claimed.created_at,
    claimed.return_status,
    records.return_reason,
    claimed.imei
  from public.claim_return_template_export_batch(
    p_batch_id,
    p_actor_id,
    p_actor,
    p_limit
  ) claimed
  join public.return_records records on records.id = claimed.id
  order by claimed.created_at, claimed.id;
$$;

revoke all on function public.claim_return_template_export_batch_v2(
  uuid, uuid, text, integer
) from public, anon, authenticated;
grant execute on function public.claim_return_template_export_batch_v2(
  uuid, uuid, text, integer
) to service_role;

comment on function public.claim_return_template_export_batch_v2(
  uuid, uuid, text, integer
) is
  'Atomically claims pending return rows and includes the official reason required by the Control workbook.';

commit;
