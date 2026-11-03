-- Automatic accessory rules can apply once per order instead of per number
-- of devices (e.g. FMC880 -> 1 QR code per order that contains a FMC880).
-- Existing rules keep working per devices.

begin;

alter table public.device_accessory_templates
  add column if not exists per_order boolean not null default false;

comment on column public.device_accessory_templates.per_order is
  'true: quantity is removed once per order that contains this device model; per_devices is then ignored.';

commit;

notify pgrst, 'reload schema';
