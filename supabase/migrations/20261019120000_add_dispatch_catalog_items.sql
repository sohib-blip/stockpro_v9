begin;

-- Dimensions used by Dispatch Planning to turn Kinesis order lines into
-- packing volume. Until now the list lived in lib/dispatch-planning.ts; keeping
-- it in the database lets warehouse users add new hardware without a release.
create table if not exists public.dispatch_catalog_items (
  id uuid primary key default gen_random_uuid(),
  name text not null check (char_length(btrim(name)) between 1 and 120),
  aliases text[] not null default '{}'::text[]
    check (cardinality(aliases) <= 25),
  length_cm numeric(8,2) not null check (length_cm between 0 and 1000),
  width_cm numeric(8,2) not null check (width_cm between 0 and 1000),
  height_cm numeric(8,2) not null check (height_cm between 0 and 1000),
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  updated_by_email text
);

create unique index if not exists dispatch_catalog_items_name_unique
  on public.dispatch_catalog_items (lower(btrim(name)));

alter table public.dispatch_catalog_items enable row level security;
revoke all on table public.dispatch_catalog_items
  from public, anon, authenticated;
grant select, insert, update, delete on table public.dispatch_catalog_items
  to service_role;

comment on table public.dispatch_catalog_items is
  'Dispatch Planning item dimensions and the Kinesis hardware labels that map to them.';

-- Seed with the dimensions previously built into the application.
insert into public.dispatch_catalog_items
  (name, aliases, length_cm, width_cm, height_cm)
values
  ('10M AV Extension Cable', '{}'::text[], 13, 13, 3),
  ('3M AV Extension Cable', '{}'::text[], 13, 4, 4),
  ('Camera - Front Facing', '{}'::text[], 9.5, 9.5, 12),
  ('Camera - Rear/Bracket Mounted', '{}'::text[], 10, 9, 9),
  ('DVR - 2 Channel -  (N+)', '{}'::text[], 20, 18, 7),
  ('Storage - 256GB SD Card', '{}'::text[], 2.2, 3, 0.2),
  ('BUZZER', '{}'::text[], 2, 4, 4),
  ('CV200 Bullet Camera', '{}'::text[], 5, 3, 6),
  ('FMB130 connectorized harness', array['FMB130 connectorized harness 22']::text[], 1.5, 7, 7),
  ('FMB140 connectorized harness', array['FMB140 connectorized harness 23']::text[], 1.5, 7, 7),
  ('3 amp Fuse mini blade', array['3 amp Fuse mini blade 11']::text[], 1.5, 1.5, 0.3),
  ('Fuse Holder - mini blade in-line', array['Fuse Holder - mini blade in-line 10']::text[], 10.5, 2, 0.3),
  ('Teltonika Contactless CAN - ECAN02', array['ECAN02']::text[], 2, 9, 2),
  ('FOB', '{}'::text[], 5, 2, 2),
  ('OBD Cable', array['OBD Cable FMC003']::text[], 1.5, 13, 11),
  ('HARDWIRED Cable for', array['HARDWIRED Cable for CV200']::text[], 14, 5, 5),
  ('READER', '{}'::text[], 11, 7, 0.5),
  ('Atom Install Guide', array['Atom Install Guide TBD001']::text[], 5.5, 8.3, 0.1),
  ('Atom Adhesive Pad', array['Atom Adhesive Pad FMC880']::text[], 5, 8, 0.2),
  ('Barra Adhesive Pad', array['Barra Adhesive Pad BAP01']::text[], 14.5, 4.5, 0.2),
  ('CV200 Adhesive Pad', array['CV200 adhesive pad CVAP', 'CV200 Adhesive Pad CVAP01']::text[], 7, 5, 0.2),
  ('Tachograph T-Harness', array['Tachograph T-Harness Tacho-T-harness']::text[], 16, 12, 2),
  ('WIPE', array['WIPE TBD011']::text[], 6.5, 7.5, 0.3),
  ('Large Cable Ties', array['Large Cable Ties 25']::text[], 0, 0, 0),
  ('NEON-T Adhesive Pads', array['NEON-T Adhesive Pads 24']::text[], 0, 0, 0),
  ('T7 Adhesive pad', array['T7 Adhesive pad T7Pad']::text[], 0, 0, 0),
  ('CNHYCV200XEU', array['AIO Camera', 'CV200XEU', 'CV200XEU-256']::text[], 9, 20, 23.5),
  ('BarraGps', array['Barra-GPS']::text[], 2.5, 5.5, 16),
  ('FMC003', '{}'::text[], 2.5, 5, 7),
  ('FMC130', '{}'::text[], 6.4, 5.5, 2),
  ('FMC234', '{}'::text[], 15, 11, 3),
  ('FMC650', '{}'::text[], 10, 7, 3),
  ('FMC920', '{}'::text[], 4, 8, 2),
  ('FMB140', '{}'::text[], 6.4, 5.5, 2),
  ('FMC880', '{}'::text[], 6, 9, 1.5),
  ('Howen2CH', array['DVR-2CH']::text[], 20, 18, 7),
  ('Neon-P', '{}'::text[], 8, 7, 3.5),
  ('Neon-R', '{}'::text[], 8, 7, 3),
  ('Howen8CH', array['DVR-8CH']::text[], 25, 24, 15),
  ('Howen4CH', array['DVR-4CH']::text[], 25, 24, 15)
on conflict do nothing;

commit;
