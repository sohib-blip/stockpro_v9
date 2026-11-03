-- IT contacts for the Dashboard security update alert.
--
-- Administrators listed here are the only ones who see the alert. While the
-- list is empty, every administrator sees it, so a critical advisory never goes
-- unnoticed. Only the server (service role) reads or changes the list, through
-- the admin-only /api/admin routes; existing roles and permissions are not
-- changed.

begin;

create table if not exists public.security_alert_recipients (
  user_id uuid primary key references auth.users(id) on delete cascade,
  added_by_email text,
  created_at timestamptz not null default now()
);

alter table public.security_alert_recipients enable row level security;
revoke all on table public.security_alert_recipients from public, anon, authenticated;
grant select, insert, update, delete on table public.security_alert_recipients to service_role;

comment on table public.security_alert_recipients is
  'Administrators designated as IT contacts: only they see the security update alert (everyone with the admin role sees it while this list is empty).';

commit;
