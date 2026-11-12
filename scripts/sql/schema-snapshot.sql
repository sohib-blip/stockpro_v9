-- Read-only catalog query used by scripts/dump-schema-snapshot.mjs.
-- Returns one row per DDL statement: (section, sort_key, ddl).
-- search_path is emptied for this transaction first (set_config in the outer
-- query, evaluated before the lateral part) so every name comes out schema-qualified.
-- Only the application schemas are described; Supabase-managed schemas
-- (auth, storage, realtime, vault, extensions, graphql...) are left out.
select q.section, q.sort_key, q.ddl
from (select set_config('search_path', '', true) as search_path) cfg
cross join lateral (
  with
  app_ns as (
    select oid, nspname, nspowner, nspacl
    from pg_namespace
    where nspname in ('public', 'private')
  ),
  app_rel as (
    select c.oid, c.relname, c.relkind, c.relowner, c.relacl, c.reloptions,
           c.relrowsecurity, c.relforcerowsecurity, n.nspname,
           format('%I.%I', n.nspname, c.relname) as qname
    from pg_class c
    join app_ns n on n.oid = c.relnamespace
    where c.relkind in ('r', 'p', 'v', 'm', 'S')
  ),
  app_fn as (
    select p.oid, p.proname, p.prokind, p.proowner, p.proacl, n.nspname,
           format('%I.%I(%s)', n.nspname, p.proname, pg_get_function_identity_arguments(p.oid)) as qname
    from pg_proc p
    join app_ns n on n.oid = p.pronamespace
    where p.prokind in ('f', 'p')
      and not exists (
        select 1 from pg_depend d
        where d.classid = 'pg_proc'::regclass and d.objid = p.oid and d.deptype = 'e'
      )
  ),
  api_roles(role_list) as (
    select 'PUBLIC, anon, authenticated, service_role'
  ),
  -- Effective privileges (NULL acl = the built-in default), owner left out.
  rel_grants as (
    select r.qname, r.relkind,
           case when a.grantee = 0 then 'PUBLIC' else quote_ident(pg_get_userbyid(a.grantee)) end as grantee,
           string_agg(a.privilege_type || case when a.is_grantable then ' WITH GRANT OPTION' else '' end, ', ' order by a.privilege_type) as privs
    from app_rel r
    cross join lateral aclexplode(coalesce(r.relacl, acldefault(case when r.relkind = 'S' then 's'::"char" else 'r'::"char" end, r.relowner))) a
    where a.grantee <> r.relowner
    group by r.qname, r.relkind, a.grantee
  ),
  col_grants as (
    select r.qname, att.attname,
           case when a.grantee = 0 then 'PUBLIC' else quote_ident(pg_get_userbyid(a.grantee)) end as grantee,
           a.privilege_type
    from app_rel r
    join pg_attribute att on att.attrelid = r.oid and att.attnum > 0 and not att.attisdropped and att.attacl is not null
    cross join lateral aclexplode(att.attacl) a
  ),
  fn_grants as (
    select f.qname, f.prokind,
           case when a.grantee = 0 then 'PUBLIC' else quote_ident(pg_get_userbyid(a.grantee)) end as grantee,
           a.privilege_type
    from app_fn f
    cross join lateral aclexplode(coalesce(f.proacl, acldefault('f'::"char", f.proowner))) a
    where a.grantee <> f.proowner
  ),
  ns_grants as (
    select n.nspname,
           case when a.grantee = 0 then 'PUBLIC' else quote_ident(pg_get_userbyid(a.grantee)) end as grantee,
           string_agg(a.privilege_type, ', ' order by a.privilege_type) as privs
    from app_ns n
    cross join lateral aclexplode(coalesce(n.nspacl, acldefault('n'::"char", n.nspowner))) a
    where a.grantee <> n.nspowner
    group by n.nspname, a.grantee
  ),
  def_acl as (
    select pg_get_userbyid(d.defaclrole) as owner_role, n.nspname,
           case d.defaclobjtype when 'r' then 'TABLES' when 'S' then 'SEQUENCES' when 'f' then 'FUNCTIONS' when 'T' then 'TYPES' when 'n' then 'SCHEMAS' end as objtype,
           case when a.grantee = 0 then 'PUBLIC' else quote_ident(pg_get_userbyid(a.grantee)) end as grantee,
           string_agg(a.privilege_type, ', ' order by a.privilege_type) as privs,
           d.defaclrole, a.grantee as grantee_oid
    from pg_default_acl d
    join app_ns n on n.oid = d.defaclnamespace
    cross join lateral aclexplode(d.defaclacl) a
    where pg_get_userbyid(d.defaclrole) = 'postgres'
    group by d.defaclrole, n.nspname, d.defaclobjtype, a.grantee
  )
  -- 10: schemas
  select 10 as section, nspname::text as sort_key,
         format('CREATE SCHEMA IF NOT EXISTS %I;', nspname) as ddl
  from app_ns
  union all
  -- 20: extensions used by the application (Supabase installs them by default)
  select 20, e.extname,
         format('CREATE EXTENSION IF NOT EXISTS %I WITH SCHEMA %I;', e.extname, n.nspname)
  from pg_extension e
  join pg_namespace n on n.oid = e.extnamespace
  where e.extname <> 'plpgsql'
  union all
  -- 30: enum types
  select 30, format('%I.%I', n.nspname, t.typname),
         format('CREATE TYPE %I.%I AS ENUM (%s);', n.nspname, t.typname,
                (select string_agg(quote_literal(e.enumlabel), ', ' order by e.enumsortorder) from pg_enum e where e.enumtypid = t.oid))
  from pg_type t
  join app_ns n on n.oid = t.typnamespace
  where t.typtype = 'e'
  union all
  -- 31: domains
  select 31, format('%I.%I', n.nspname, t.typname),
         format('CREATE DOMAIN %I.%I AS %s%s%s;', n.nspname, t.typname, format_type(t.typbasetype, t.typtypmod),
                case when t.typnotnull then ' NOT NULL' else '' end,
                coalesce((select string_agg(' CONSTRAINT ' || quote_ident(c.conname) || ' ' || pg_get_constraintdef(c.oid), '' order by c.conname) from pg_constraint c where c.contypid = t.oid), ''))
  from pg_type t
  join app_ns n on n.oid = t.typnamespace
  where t.typtype = 'd'
  union all
  -- 40: standalone sequences (identity sequences are part of their column)
  select 40, r.qname,
         format('CREATE SEQUENCE IF NOT EXISTS %s AS %s START WITH %s INCREMENT BY %s MINVALUE %s MAXVALUE %s CACHE %s%s;',
                r.qname, format_type(s.seqtypid, null), s.seqstart, s.seqincrement, s.seqmin, s.seqmax, s.seqcache,
                case when s.seqcycle then ' CYCLE' else '' end)
  from app_rel r
  join pg_sequence s on s.seqrelid = r.oid
  where r.relkind = 'S'
    and not exists (select 1 from pg_depend d where d.classid = 'pg_class'::regclass and d.objid = r.oid and d.deptype = 'i')
  union all
  -- 50: tables and their columns
  select 50, r.qname,
         format(E'CREATE TABLE IF NOT EXISTS %s (\n%s\n);', r.qname,
                (select string_agg(
                          format('    %I %s', a.attname, format_type(a.atttypid, a.atttypmod))
                          || case a.attidentity when 'a' then ' GENERATED ALWAYS AS IDENTITY' when 'd' then ' GENERATED BY DEFAULT AS IDENTITY' else '' end
                          || case
                               when a.attgenerated = 's' then ' GENERATED ALWAYS AS (' || pg_get_expr(d.adbin, d.adrelid) || ') STORED'
                               when d.adbin is not null then ' DEFAULT ' || pg_get_expr(d.adbin, d.adrelid)
                               else ''
                             end
                          || case when a.attnotnull then ' NOT NULL' else '' end,
                          E',\n' order by a.attnum)
                 from pg_attribute a
                 left join pg_attrdef d on d.adrelid = a.attrelid and d.adnum = a.attnum
                 where a.attrelid = r.oid and a.attnum > 0 and not a.attisdropped))
  from app_rel r
  where r.relkind in ('r', 'p')
  union all
  -- 55: primary keys, unique, check and exclusion constraints
  select 55, r.qname || ' ' || case c.contype when 'p' then '1' when 'u' then '2' when 'x' then '3' else '4' end || ' ' || c.conname,
         format('ALTER TABLE ONLY %s ADD CONSTRAINT %I %s;', r.qname, c.conname, pg_get_constraintdef(c.oid))
  from pg_constraint c
  join app_rel r on r.oid = c.conrelid
  where c.contype in ('p', 'u', 'c', 'x')
  union all
  -- 60: indexes that do not back a constraint
  select 60, r.qname || ' ' || ic.relname,
         pg_get_indexdef(i.indexrelid) || ';'
  from pg_index i
  join app_rel r on r.oid = i.indrelid
  join pg_class ic on ic.oid = i.indexrelid
  where not exists (select 1 from pg_constraint c where c.conindid = i.indexrelid and c.contype in ('p', 'u', 'x'))
  union all
  -- 65: sequences owned by a column (serial)
  select 65, r.qname,
         format('ALTER SEQUENCE %s OWNED BY %s.%I;', r.qname, tr.qname, a.attname)
  from app_rel r
  join pg_depend d on d.classid = 'pg_class'::regclass and d.objid = r.oid and d.deptype = 'a'
  join app_rel tr on tr.oid = d.refobjid
  join pg_attribute a on a.attrelid = d.refobjid and a.attnum = d.refobjsubid
  where r.relkind = 'S'
  union all
  -- 70: functions and procedures
  select 70, f.qname,
         rtrim(pg_get_functiondef(f.oid), E'\n') || ';'
  from app_fn f
  union all
  -- 75: views (they only read tables, so they come after the tables and functions)
  select 75, r.qname,
         format(E'CREATE OR REPLACE VIEW %s%s AS\n%s', r.qname,
                case when r.reloptions is not null then ' WITH (' || array_to_string(r.reloptions, ', ') || ')' else '' end,
                rtrim(pg_get_viewdef(r.oid, true), E'\n'))
  from app_rel r
  where r.relkind = 'v'
  union all
  -- 76: materialized views
  select 76, r.qname,
         format(E'CREATE MATERIALIZED VIEW IF NOT EXISTS %s AS\n%s', r.qname, rtrim(pg_get_viewdef(r.oid, true), E'\n'))
  from app_rel r
  where r.relkind = 'm'
  union all
  -- 80: foreign keys (after every table exists)
  select 80, r.qname || ' ' || c.conname,
         format('ALTER TABLE ONLY %s ADD CONSTRAINT %I %s;', r.qname, c.conname, pg_get_constraintdef(c.oid))
  from pg_constraint c
  join app_rel r on r.oid = c.conrelid
  where c.contype = 'f'
  union all
  -- 85: triggers
  select 85, r.qname || ' ' || t.tgname,
         pg_get_triggerdef(t.oid, true) || ';'
  from pg_trigger t
  join app_rel r on r.oid = t.tgrelid
  where not t.tgisinternal
  union all
  -- 90: row level security switches
  select 90, r.qname,
         format('ALTER TABLE %s ENABLE ROW LEVEL SECURITY;', r.qname)
         || case when r.relforcerowsecurity then format(E'\nALTER TABLE %s FORCE ROW LEVEL SECURITY;', r.qname) else '' end
  from app_rel r
  where r.relkind in ('r', 'p') and r.relrowsecurity
  union all
  -- 92: policies
  select 92, r.qname || ' ' || p.polname,
         format('CREATE POLICY %I ON %s AS %s FOR %s TO %s%s%s;',
                p.polname, r.qname,
                case when p.polpermissive then 'PERMISSIVE' else 'RESTRICTIVE' end,
                case p.polcmd when 'r' then 'SELECT' when 'a' then 'INSERT' when 'w' then 'UPDATE' when 'd' then 'DELETE' else 'ALL' end,
                case when p.polroles = '{0}'::oid[] then 'PUBLIC'
                     else (select string_agg(quote_ident(pg_get_userbyid(ro)), ', ' order by pg_get_userbyid(ro)) from unnest(p.polroles) ro) end,
                case when p.polqual is not null then E'\n    USING (' || pg_get_expr(p.polqual, p.polrelid) || ')' else '' end,
                case when p.polwithcheck is not null then E'\n    WITH CHECK (' || pg_get_expr(p.polwithcheck, p.polrelid) || ')' else '' end)
  from pg_policy p
  join app_rel r on r.oid = p.polrelid
  union all
  -- 95: schema privileges
  select 95, nspname || ' ' || grantee,
         format('GRANT %s ON SCHEMA %I TO %s;', privs, nspname, grantee)
  from ns_grants
  union all
  -- 96: table, view and sequence privileges (revoke the API roles first, then grant what the database really has)
  select 96, r.qname || ' 0',
         format('REVOKE ALL ON %s %s FROM %s;', case when r.relkind = 'S' then 'SEQUENCE' else 'TABLE' end, r.qname, (select role_list from api_roles))
  from app_rel r
  union all
  select 96, g.qname || ' 1 ' || g.grantee,
         format('GRANT %s ON %s %s TO %s;', g.privs, case when g.relkind = 'S' then 'SEQUENCE' else 'TABLE' end, g.qname, g.grantee)
  from rel_grants g
  union all
  select 96, g.qname || ' 2 ' || g.attname || ' ' || g.grantee || ' ' || g.privilege_type,
         format('GRANT %s (%I) ON TABLE %s TO %s;', g.privilege_type, g.attname, g.qname, g.grantee)
  from col_grants g
  union all
  -- 97: function privileges
  select 97, f.qname || ' 0',
         format('REVOKE ALL ON %s %s FROM %s;', case when f.prokind = 'p' then 'PROCEDURE' else 'FUNCTION' end, f.qname, (select role_list from api_roles))
  from app_fn f
  union all
  select 97, g.qname || ' 1 ' || g.grantee,
         format('GRANT %s ON %s %s TO %s;', g.privilege_type, case when g.prokind = 'p' then 'PROCEDURE' else 'FUNCTION' end, g.qname, g.grantee)
  from fn_grants g
  union all
  -- 98: default privileges for objects created later by postgres
  select 98, nspname || ' ' || objtype || ' 0',
         format('ALTER DEFAULT PRIVILEGES FOR ROLE %I IN SCHEMA %I REVOKE ALL ON %s FROM %s;', owner_role, nspname, objtype, (select role_list from api_roles))
  from (select distinct owner_role, nspname, objtype from def_acl) d
  union all
  select 98, nspname || ' ' || objtype || ' 1 ' || grantee,
         format('ALTER DEFAULT PRIVILEGES FOR ROLE %I IN SCHEMA %I GRANT %s ON %s TO %s;', owner_role, nspname, privs, objtype, grantee)
  from def_acl
  where grantee_oid <> defaclrole
  union all
  -- 99: comments
  select 99, r.qname || coalesce('.' || a.attname, ''),
         format('COMMENT ON %s %s IS %s;',
                case when a.attname is not null then 'COLUMN' when r.relkind = 'v' then 'VIEW' else 'TABLE' end,
                r.qname || coalesce('.' || quote_ident(a.attname), ''),
                quote_literal(d.description))
  from pg_description d
  join app_rel r on d.classoid = 'pg_class'::regclass and d.objoid = r.oid
  left join pg_attribute a on a.attrelid = r.oid and a.attnum = d.objsubid and d.objsubid > 0
  union all
  select 99, f.qname,
         format('COMMENT ON FUNCTION %s IS %s;', f.qname, quote_literal(d.description))
  from pg_description d
  join app_fn f on d.classoid = 'pg_proc'::regclass and d.objoid = f.oid
  union all
  select 99, n.nspname,
         format('COMMENT ON SCHEMA %I IS %s;', n.nspname, quote_literal(d.description))
  from pg_description d
  join app_ns n on d.classoid = 'pg_namespace'::regclass and d.objoid = n.oid
) q
order by 1, 2;
