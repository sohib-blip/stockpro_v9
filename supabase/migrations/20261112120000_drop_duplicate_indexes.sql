begin;

-- Drop indexes that duplicate another index on the same columns. They came
-- from the original tables (before the migrations) and every insert or update
-- on items / movements / audit_events had to maintain all of them.
--
-- Each index is dropped only when:
--   * its definition is exactly the expected one (a same-named index that
--     differs, e.g. in Production, is left alone), and
--   * the index kept in its place exists with the expected definition
--     (items_imei_key must still be a UNIQUE constraint), so no column loses
--     its index and items.imei keeps its uniqueness.
-- Otherwise the index is kept and a notice is raised. No data is changed.
do $$
declare
  v_pair record;
  v_dropped integer := 0;
begin
  if not exists (
    select 1 from pg_constraint
    where conrelid = 'public.items'::regclass
      and conname = 'items_imei_key'
      and contype = 'u'
  ) then
    raise exception 'public.items has no items_imei_key UNIQUE constraint: review the IMEI indexes by hand';
  end if;

  for v_pair in
    select * from (values
      -- items.imei: keep the constraint items_imei_key
      ('idx_items_imei',          'CREATE UNIQUE INDEX idx_items_imei ON public.items USING btree (imei)',
       'items_imei_key',          'CREATE UNIQUE INDEX items_imei_key ON public.items USING btree (imei)'),
      ('items_imei_unique',       'CREATE UNIQUE INDEX items_imei_unique ON public.items USING btree (imei)',
       'items_imei_key',          'CREATE UNIQUE INDEX items_imei_key ON public.items USING btree (imei)'),
      ('items_unique_imei',       'CREATE UNIQUE INDEX items_unique_imei ON public.items USING btree (imei)',
       'items_imei_key',          'CREATE UNIQUE INDEX items_imei_key ON public.items USING btree (imei)'),
      -- items.box_id / items.device_id
      ('idx_items_box',           'CREATE INDEX idx_items_box ON public.items USING btree (box_id)',
       'idx_items_box_id',        'CREATE INDEX idx_items_box_id ON public.items USING btree (box_id)'),
      ('idx_items_device',        'CREATE INDEX idx_items_device ON public.items USING btree (device_id)',
       'idx_items_device_id',     'CREATE INDEX idx_items_device_id ON public.items USING btree (device_id)'),
      -- movements.batch_id: the (batch_id, type) index also serves batch_id lookups
      ('idx_movements_batch',     'CREATE INDEX idx_movements_batch ON public.movements USING btree (batch_id)',
       'movements_batch_type_idx','CREATE INDEX movements_batch_type_idx ON public.movements USING btree (batch_id, type)'),
      ('idx_movements_batch_id',  'CREATE INDEX idx_movements_batch_id ON public.movements USING btree (batch_id)',
       'movements_batch_type_idx','CREATE INDEX movements_batch_type_idx ON public.movements USING btree (batch_id, type)'),
      -- movements.created_at: one index is enough (a btree is read in both directions)
      ('idx_movements_created',   'CREATE INDEX idx_movements_created ON public.movements USING btree (created_at)',
       'movements_created_at_idx','CREATE INDEX movements_created_at_idx ON public.movements USING btree (created_at DESC)'),
      ('idx_movements_date',      'CREATE INDEX idx_movements_date ON public.movements USING btree (created_at)',
       'movements_created_at_idx','CREATE INDEX movements_created_at_idx ON public.movements USING btree (created_at DESC)'),
      ('idx_movements_created_at','CREATE INDEX idx_movements_created_at ON public.movements USING btree (created_at DESC)',
       'movements_created_at_idx','CREATE INDEX movements_created_at_idx ON public.movements USING btree (created_at DESC)'),
      -- audit_events.created_at
      ('idx_audit_created_at',    'CREATE INDEX idx_audit_created_at ON public.audit_events USING btree (created_at)',
       'idx_audit_events_created_at','CREATE INDEX idx_audit_events_created_at ON public.audit_events USING btree (created_at DESC)')
    ) as p(drop_name, drop_def, keep_name, keep_def)
  loop
    if to_regclass('public.' || v_pair.drop_name) is null then
      continue;
    end if;

    if pg_get_indexdef(to_regclass('public.' || v_pair.drop_name)) <> v_pair.drop_def then
      raise notice 'kept %: definition differs (%)', v_pair.drop_name,
        pg_get_indexdef(to_regclass('public.' || v_pair.drop_name));
      continue;
    end if;

    if to_regclass('public.' || v_pair.keep_name) is null
       or pg_get_indexdef(to_regclass('public.' || v_pair.keep_name)) <> v_pair.keep_def then
      raise notice 'kept %: % is missing or different', v_pair.drop_name, v_pair.keep_name;
      continue;
    end if;

    if exists (
      select 1 from pg_constraint
      where conindid = to_regclass('public.' || v_pair.drop_name)
    ) then
      raise notice 'kept %: a constraint uses it', v_pair.drop_name;
      continue;
    end if;

    execute format('drop index public.%I', v_pair.drop_name);
    v_dropped := v_dropped + 1;
  end loop;

  raise notice 'duplicate indexes dropped: %', v_dropped;
end
$$;

commit;
