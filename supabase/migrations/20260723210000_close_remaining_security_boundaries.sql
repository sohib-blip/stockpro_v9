begin;

-- Supabase access tokens carry a signed session_id claim. Store that exact
-- value so protected requests can be bound to one current server-side session.
alter table public.profiles
  alter column current_session_id type text
  using current_session_id::text;

alter table public.connection_events
  add column if not exists auth_session_id text null;

alter table public.connection_events
  drop constraint if exists connection_events_auth_session_id_check;
alter table public.connection_events
  add constraint connection_events_auth_session_id_check
  check (
    auth_session_id is null or
    auth_session_id ~ '^[A-Za-z0-9_-]{1,128}$'
  );

create or replace function private.has_active_app_session(uid uuid)
returns boolean
language sql
stable
security definer
set search_path = pg_catalog, public, private
as $$
  select exists (
    select 1
    from public.profiles p
    where p.user_id = uid
      and p.current_session_id = (select auth.jwt() ->> 'session_id')
      and p.last_seen_at >= statement_timestamp() - interval '1 hour'
  );
$$;

create or replace function public.activate_app_session(
  p_user_id uuid,
  p_session_id text,
  p_email text
) returns text
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  v_current_session_id text;
  v_last_seen_at timestamptz;
begin
  if p_session_id is null
     or p_session_id !~ '^[A-Za-z0-9_-]{1,128}$' then
    raise exception 'invalid application session'
      using errcode = '22023';
  end if;

  perform pg_advisory_xact_lock(
    hashtextextended('stockpro-app-session:' || p_user_id::text, 0)
  );

  select current_session_id, last_seen_at
    into v_current_session_id, v_last_seen_at
  from public.profiles
  where user_id = p_user_id
  for update;

  if not found then
    insert into public.profiles (
      user_id,
      email,
      current_session_id,
      last_seen_at
    ) values (
      p_user_id,
      lower(p_email),
      p_session_id,
      statement_timestamp()
    );
    return 'activated';
  end if;

  if v_current_session_id is not null
     and v_current_session_id <> p_session_id
     and v_last_seen_at >= statement_timestamp() - interval '2 minutes' then
    return 'conflict';
  end if;

  update public.profiles
  set current_session_id = p_session_id,
      last_seen_at = statement_timestamp()
  where user_id = p_user_id;

  return 'activated';
end;
$$;

create or replace function public.touch_app_session(
  p_user_id uuid,
  p_session_id text
) returns boolean
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  v_touched boolean;
begin
  update public.profiles
  set last_seen_at = statement_timestamp()
  where user_id = p_user_id
    and current_session_id = p_session_id
    and last_seen_at >= statement_timestamp() - interval '1 hour'
  returning true into v_touched;

  return coalesce(v_touched, false);
end;
$$;

create or replace function public.take_over_app_session(
  p_user_id uuid,
  p_session_id text,
  p_event_id uuid
) returns boolean
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  v_event_id uuid;
begin
  if p_session_id is null
     or p_session_id !~ '^[A-Za-z0-9_-]{1,128}$' then
    return false;
  end if;

  perform pg_advisory_xact_lock(
    hashtextextended('stockpro-app-session:' || p_user_id::text, 0)
  );

  select id
    into v_event_id
  from public.connection_events
  where id = p_event_id
    and user_id = p_user_id
    and successful = true
    and takeover = false
    and auth_session_id = p_session_id
    and created_at >= statement_timestamp() - interval '10 minutes'
  for update;

  if v_event_id is null then
    return false;
  end if;

  update public.profiles
  set current_session_id = p_session_id,
      last_seen_at = statement_timestamp()
  where user_id = p_user_id;

  if not found then
    return false;
  end if;

  update public.connection_events
  set takeover = true
  where id = v_event_id;

  return true;
end;
$$;

create or replace function public.end_app_session(
  p_user_id uuid,
  p_session_id text
) returns boolean
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  v_ended boolean;
begin
  update public.profiles
  set current_session_id = null,
      last_seen_at = statement_timestamp()
  where user_id = p_user_id
    and current_session_id = p_session_id
  returning true into v_ended;

  return coalesce(v_ended, false);
end;
$$;

-- Session mutation is a server authorization decision. Authenticated browser
-- clients may still read their own status but cannot replace or revive it.
revoke insert, update on table public.profiles from authenticated;

create or replace function private.has_app_role(uid uuid)
returns boolean
language sql
stable
security definer
set search_path = pg_catalog, public, private
as $$
  select private.has_active_app_session(uid) and exists (
    select 1
    from public.user_roles r
    where r.user_id = uid
      and r.role in ('admin', 'operator', 'viewer')
  );
$$;

create or replace function private.is_admin(uid uuid)
returns boolean
language sql
stable
security definer
set search_path = pg_catalog, public, private
as $$
  select private.has_active_app_session(uid) and exists (
    select 1
    from public.user_roles r
    where r.user_id = uid
      and r.role = 'admin'
  );
$$;

create or replace function public.is_admin(uid uuid)
returns boolean
language sql
stable
security definer
set search_path = pg_catalog, public, private
as $$
  select private.is_admin(uid);
$$;

drop policy if exists profiles_select_own on public.profiles;
drop policy if exists profiles_insert_own on public.profiles;
drop policy if exists profiles_update_own on public.profiles;
create policy profiles_select_active_own
on public.profiles
for select
to authenticated
using (
  (select auth.uid()) = user_id
  and private.has_active_app_session((select auth.uid()))
);

drop policy if exists user_roles_select_own on public.user_roles;
create policy user_roles_select_active_own
on public.user_roles
for select
to authenticated
using (
  (select auth.uid()) = user_id
  and private.has_active_app_session((select auth.uid()))
);

drop policy if exists user_permissions_select_own on public.user_permissions;
create policy user_permissions_select_active_own
on public.user_permissions
for select
to authenticated
using (
  (select auth.uid()) = user_id
  and private.has_active_app_session((select auth.uid()))
);

drop policy if exists boxes_authenticated_update on public.boxes;
drop policy if exists boxes_permission_update on public.boxes;
create policy boxes_permission_update
on public.boxes
for update
to authenticated
using (
  private.has_permission((select auth.uid()), 'can_transfer')
  or private.has_permission((select auth.uid()), 'can_bins')
)
with check (
  private.has_permission((select auth.uid()), 'can_transfer')
  or private.has_permission((select auth.uid()), 'can_bins')
);

revoke all privileges on function private.has_active_app_session(uuid)
  from public, anon, authenticated;
revoke all privileges on function private.has_app_role(uuid)
  from public, anon, authenticated;
revoke all privileges on function private.is_admin(uuid)
  from public, anon, authenticated;
revoke all privileges on function public.is_admin(uuid)
  from public, anon, authenticated;
grant execute on function private.has_active_app_session(uuid)
  to authenticated, service_role;
grant execute on function private.has_app_role(uuid)
  to authenticated, service_role;
grant execute on function private.is_admin(uuid)
  to authenticated, service_role;
grant execute on function public.is_admin(uuid)
  to authenticated, service_role;

revoke all on function public.activate_app_session(uuid, text, text)
  from public, anon, authenticated;
revoke all on function public.touch_app_session(uuid, text)
  from public, anon, authenticated;
revoke all on function public.take_over_app_session(uuid, text, uuid)
  from public, anon, authenticated;
revoke all on function public.end_app_session(uuid, text)
  from public, anon, authenticated;
grant execute on function public.activate_app_session(uuid, text, text) to service_role;
grant execute on function public.touch_app_session(uuid, text) to service_role;
grant execute on function public.take_over_app_session(uuid, text, uuid) to service_role;
grant execute on function public.end_app_session(uuid, text) to service_role;

-- Role plus permissions form one authorization state and must commit together.
create or replace function public.save_user_access(
  p_user_id uuid,
  p_role text,
  p_permissions jsonb
) returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  v_current_role text;
  v_admin_count bigint;
  v_permissions jsonb;
begin
  if p_role not in ('admin', 'operator', 'viewer') then
    raise exception 'invalid application role'
      using errcode = '22023';
  end if;

  perform pg_advisory_xact_lock(
    hashtextextended('stockpro-user-access', 0)
  );

  select role into v_current_role
  from public.user_roles
  where user_id = p_user_id
  for update;

  if v_current_role = 'admin' and p_role <> 'admin' then
    select count(*) into v_admin_count
    from public.user_roles
    where role = 'admin';

    if v_admin_count <= 1 then
      raise exception 'The last administrator cannot be removed'
        using errcode = '23514';
    end if;
  end if;

  v_permissions := jsonb_build_object(
    'can_dashboard', case when p_role = 'admin' then true else coalesce((p_permissions ->> 'can_dashboard')::boolean, false) end,
    'can_inventory_export', case when p_role = 'admin' then true else coalesce((p_permissions ->> 'can_inventory_export')::boolean, false) end,
    'can_inbound', case when p_role = 'admin' then true else coalesce((p_permissions ->> 'can_inbound')::boolean, false) end,
    'can_outbound', case when p_role = 'admin' then true else coalesce((p_permissions ->> 'can_outbound')::boolean, false) end,
    'can_returns', case when p_role = 'admin' then true else coalesce((p_permissions ->> 'can_returns')::boolean, false) end,
    'can_transfer', case when p_role = 'admin' then true else coalesce((p_permissions ->> 'can_transfer')::boolean, false) end,
    'can_labels', case when p_role = 'admin' then true else coalesce((p_permissions ->> 'can_labels')::boolean, false) end,
    'can_bins', case when p_role = 'admin' then true else coalesce((p_permissions ->> 'can_bins')::boolean, false) end,
    'can_accessories', case when p_role = 'admin' then true else coalesce((p_permissions ->> 'can_accessories')::boolean, false) end,
    'can_supply', case when p_role = 'admin' then true else coalesce((p_permissions ->> 'can_supply')::boolean, false) end,
    'can_nrd', case when p_role = 'admin' then true else coalesce((p_permissions ->> 'can_nrd')::boolean, false) end,
    'can_admin', p_role = 'admin'
  );

  insert into public.user_roles (user_id, role)
  values (p_user_id, p_role)
  on conflict (user_id) do update
  set role = excluded.role;

  insert into public.user_permissions (
    user_id,
    can_dashboard,
    can_inventory_export,
    can_inbound,
    can_outbound,
    can_returns,
    can_transfer,
    can_labels,
    can_bins,
    can_accessories,
    can_supply,
    can_nrd,
    can_admin
  ) values (
    p_user_id,
    (v_permissions ->> 'can_dashboard')::boolean,
    (v_permissions ->> 'can_inventory_export')::boolean,
    (v_permissions ->> 'can_inbound')::boolean,
    (v_permissions ->> 'can_outbound')::boolean,
    (v_permissions ->> 'can_returns')::boolean,
    (v_permissions ->> 'can_transfer')::boolean,
    (v_permissions ->> 'can_labels')::boolean,
    (v_permissions ->> 'can_bins')::boolean,
    (v_permissions ->> 'can_accessories')::boolean,
    (v_permissions ->> 'can_supply')::boolean,
    (v_permissions ->> 'can_nrd')::boolean,
    (v_permissions ->> 'can_admin')::boolean
  )
  on conflict (user_id) do update set
    can_dashboard = excluded.can_dashboard,
    can_inventory_export = excluded.can_inventory_export,
    can_inbound = excluded.can_inbound,
    can_outbound = excluded.can_outbound,
    can_returns = excluded.can_returns,
    can_transfer = excluded.can_transfer,
    can_labels = excluded.can_labels,
    can_bins = excluded.can_bins,
    can_accessories = excluded.can_accessories,
    can_supply = excluded.can_supply,
    can_nrd = excluded.can_nrd,
    can_admin = excluded.can_admin;

  return v_permissions;
end;
$$;

-- Remove any legacy mixed authorization state and make role the canonical
-- administrator signal for direct database permission checks.
update public.user_permissions p
set can_admin = (r.role = 'admin')
from public.user_roles r
where r.user_id = p.user_id
  and p.can_admin is distinct from (r.role = 'admin');

create or replace function private.has_permission(uid uuid, permission_name text)
returns boolean
language sql
stable
security definer
set search_path = pg_catalog, public, private
as $$
  select private.has_active_app_session(uid) and (
    private.is_admin(uid) or exists (
      select 1
      from public.user_permissions p
      where p.user_id = uid
        and case permission_name
          when 'can_dashboard' then p.can_dashboard
          when 'can_inventory_export' then p.can_inventory_export
          when 'can_inbound' then p.can_inbound
          when 'can_outbound' then p.can_outbound
          when 'can_returns' then p.can_returns
          when 'can_transfer' then p.can_transfer
          when 'can_labels' then p.can_labels
          when 'can_bins' then p.can_bins
          when 'can_accessories' then p.can_accessories
          when 'can_supply' then p.can_supply
          when 'can_nrd' then p.can_nrd
          when 'can_admin' then false
          else false
        end
    )
  );
$$;

revoke all on function public.save_user_access(uuid, text, jsonb)
  from public, anon, authenticated;
grant execute on function public.save_user_access(uuid, text, jsonb) to service_role;
revoke all privileges on function private.has_permission(uuid, text)
  from public, anon, authenticated;
grant execute on function private.has_permission(uuid, text)
  to authenticated, service_role;

commit;
