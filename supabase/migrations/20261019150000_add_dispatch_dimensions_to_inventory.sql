begin;

-- Dispatch Planning reads item dimensions from Device Bins and Accessory
-- Inventory records. kinesis_names lists the Kinesis Hardware Type labels that
-- refer to the record; for accessories the first one names the packing line.

-- Replaced by the columns below; it only ever existed on staging.
drop table if exists public.dispatch_catalog_items;

alter table public.bins
  add column if not exists length_cm numeric(8,2),
  add column if not exists width_cm numeric(8,2),
  add column if not exists height_cm numeric(8,2),
  add column if not exists kinesis_names text[] not null default '{}'::text[];

alter table public.bins
  drop constraint if exists bins_dispatch_dimensions_check;
alter table public.bins
  add constraint bins_dispatch_dimensions_check check (
    (length_cm is null and width_cm is null and height_cm is null)
    or (
      length_cm between 0 and 1000
      and width_cm between 0 and 1000
      and height_cm between 0 and 1000
    )
  );
alter table public.bins
  drop constraint if exists bins_kinesis_names_check;
alter table public.bins
  add constraint bins_kinesis_names_check
  check (cardinality(kinesis_names) <= 25);

alter table public.accessory_bins
  add column if not exists length_cm numeric(8,2),
  add column if not exists width_cm numeric(8,2),
  add column if not exists height_cm numeric(8,2),
  add column if not exists kinesis_names text[] not null default '{}'::text[];

alter table public.accessory_bins
  drop constraint if exists accessory_bins_dispatch_dimensions_check;
alter table public.accessory_bins
  add constraint accessory_bins_dispatch_dimensions_check check (
    (length_cm is null and width_cm is null and height_cm is null)
    or (
      length_cm between 0 and 1000
      and width_cm between 0 and 1000
      and height_cm between 0 and 1000
    )
  );
alter table public.accessory_bins
  drop constraint if exists accessory_bins_kinesis_names_check;
alter table public.accessory_bins
  add constraint accessory_bins_kinesis_names_check
  check (cardinality(kinesis_names) <= 25);

comment on column public.bins.kinesis_names is
  'Kinesis Hardware Type labels that refer to this device model.';
comment on column public.accessory_bins.kinesis_names is
  'Kinesis Hardware Type labels that refer to this accessory; the first one names it in dispatch packing lists.';

-- Dimensions previously built into the application, matched on the record
-- name without punctuation. Values entered in the app are never overwritten.
update public.bins as bin
set
  length_cm = item.length_cm,
  width_cm = item.width_cm,
  height_cm = item.height_cm,
  kinesis_names = item.kinesis_names
from (
values
  ('cnhycv200xeu', 9, 20, 23.5, array['AIO Camera', 'CV200XEU', 'CV200XEU-256']::text[]),
  ('barragps', 2.5, 5.5, 16, '{}'::text[]),
  ('fmc003', 2.5, 5, 7, '{}'::text[]),
  ('fmc130', 6.4, 5.5, 2, '{}'::text[]),
  ('fmc150', 6.4, 5.5, 2, '{}'::text[]),
  ('fmc234', 15, 11, 3, '{}'::text[]),
  ('fmc650', 10, 7, 3, '{}'::text[]),
  ('fmc920', 4, 8, 2, '{}'::text[]),
  ('fmb140', 6.4, 5.5, 2, '{}'::text[]),
  ('fmc880', 6, 9, 1.5, '{}'::text[]),
  ('howen2ch', 20, 18, 7, array['DVR - 2 Channel -  (N+)', 'DVR-2CH']::text[]),
  ('howen4ch', 25, 24, 15, array['DVR-4CH']::text[]),
  ('howen8ch', 25, 24, 15, array['DVR-8CH']::text[]),
  ('neonp', 8, 7, 3.5, '{}'::text[]),
  ('neonr', 8, 7, 3, '{}'::text[])
) as item(name_key, length_cm, width_cm, height_cm, kinesis_names)
where regexp_replace(lower(bin.name), '[^a-z0-9]+', '', 'g') = item.name_key
  and bin.length_cm is null;

update public.accessory_bins as accessory
set
  length_cm = item.length_cm,
  width_cm = item.width_cm,
  height_cm = item.height_cm,
  kinesis_names = item.kinesis_names
from (
values
  ('10mavextensioncablepro905', 13, 13, 3, array['10M AV Extension Cable']::text[]),
  ('3mavextensioncablepro900', 13, 4, 4, array['3M AV Extension Cable']::text[]),
  ('camerafrontfacingpro895', 9.5, 9.5, 12, array['Camera - Front Facing']::text[]),
  ('camerarearbracketmountedpro1023', 10, 9, 9, array['Camera - Rear/Bracket Mounted']::text[]),
  ('storage256gbsdcardpro907', 2.2, 3, 0.2, array['Storage - 256GB SD Card']::text[]),
  ('buzzer4', 2, 4, 4, array['BUZZER']::text[]),
  ('cv200bulletcamera', 5, 3, 6, array['CV200 Bullet Camera']::text[]),
  ('fmb130connectorizedharness22', 1.5, 7, 7, array['FMB130 connectorized harness']::text[]),
  ('fmb140connectorizedharness23', 1.5, 7, 7, array['FMB140 connectorized harness']::text[]),
  ('3ampfuseminiblade11', 1.5, 1.5, 0.3, array['3 amp Fuse mini blade']::text[]),
  ('fuseholderminibladeinline10', 10.5, 2, 0.3, array['Fuse Holder - mini blade in-line']::text[]),
  ('teltonikacontactlesscanecan02ecan02', 2, 9, 2, array['Teltonika Contactless CAN - ECAN02', 'ECAN02']::text[]),
  ('fob1', 5, 2, 2, array['FOB']::text[]),
  ('obdcablefmc003', 1.5, 13, 11, array['OBD Cable']::text[]),
  ('hardwiredcableforcv200', 14, 5, 5, array['HARDWIRED Cable for']::text[]),
  ('reader3', 11, 7, 0.5, array['READER']::text[]),
  ('atominstallguidetbd001', 5.5, 8.3, 0.1, array['Atom Install Guide']::text[]),
  ('atomadhesivepad', 5, 8, 0.2, array['Atom Adhesive Pad', 'Atom Adhesive Pad FMC880']::text[]),
  ('barraadhesivepadbap01', 14.5, 4.5, 0.2, array['Barra Adhesive Pad']::text[]),
  ('cv200adhesivepadcvap01', 7, 5, 0.2, array['CV200 Adhesive Pad']::text[]),
  ('tachographtharnesstachotharness', 16, 12, 2, array['Tachograph T-Harness']::text[]),
  ('wipetbd011', 6.5, 7.5, 0.3, array['WIPE']::text[]),
  ('largecableties25', 0, 0, 0, array['Large Cable Ties']::text[]),
  ('neontadhesivepads24', 0, 0, 0, array['NEON-T Adhesive Pads']::text[]),
  ('t7adhesivepadt7pad', 0, 0, 0, array['T7 Adhesive pad']::text[])
) as item(name_key, length_cm, width_cm, height_cm, kinesis_names)
where regexp_replace(lower(accessory.name), '[^a-z0-9]+', '', 'g') = item.name_key
  and accessory.length_cm is null
  and coalesce(accessory.category, '') <> 'Packages';

commit;
