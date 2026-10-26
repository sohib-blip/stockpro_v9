begin;

-- Optional limit of a packaging rule: it only applies while the order holds
-- at most this many of the trigger. Example: one CV200 Sleeve per camera, but
-- no sleeve once an order has 3 cameras or more (they share a carton).
alter table public.packaging_rules
  add column if not exists max_trigger_count integer;

alter table public.packaging_rules
  drop constraint if exists packaging_rules_max_trigger_count_check;
alter table public.packaging_rules
  add constraint packaging_rules_max_trigger_count_check
  check (max_trigger_count is null or max_trigger_count between 1 and 100000);

commit;
