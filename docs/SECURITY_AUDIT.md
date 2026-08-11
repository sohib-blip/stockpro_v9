# Security audit baseline

Date: 16 July 2026

Scope: static review of the `staging` code only. Production was not modified.

## API authentication and authorization

Status on the staging branch: remediated.

- Every `/api/*` request is intercepted before its route handler runs.
- A valid Supabase bearer token is required (`401` otherwise).
- The caller must have a role and at least one permission mapped to the route
  (`403` otherwise).
- Unknown future routes fail closed until an access policy is added.
- The low-stock cron is the only exception to user authentication and keeps its
  dedicated `CRON_SECRET` validation.
- Browser downloads now use the authenticated API client as well.

This is required because Supabase service-role credentials bypass Row Level
Security. The API middleware now performs the missing authorization before a
service-role route can read or change data.

The automated security test enumerates every exported API method and verifies
that it has an explicit permission mapping.

## Roles and administration

- Roles: `admin`, `operator`, `viewer`.
- Module permissions: dashboard, inbound, outbound, returns, transfer, labels,
  bins, accessories, supply, NRD and administration.
- Admins can invite users and edit roles/permissions from `/admin`.
- The last administrator cannot be demoted.
- Navigation and page access use the same permission model as the API.
- Direct browser writes to bins, boxes and thresholds are also restricted by
  RLS permission helpers.

Reference: [Supabase Row Level Security documentation](https://supabase.com/docs/guides/database/postgres/row-level-security).

## Dependency review

- Removed the unused `jspdf` dependency, which carried critical advisories.
- Upgraded SheetJS from the old npm release to the official 0.20.3 tarball.
- Applied compatible transitive fixes for `ws`, `tmp`, `minimatch` and
  `brace-expansion`.
- Added an override for the vulnerable `uuid` version used by ExcelJS, with a
  workbook-generation regression test.
- A major Next.js upgrade is still required in a dedicated migration. It must
  not be forced into production without full staging validation.

After these changes, `npm audit --omit=dev` reports 2 remaining production
findings instead of 11. Both are in the current Next.js/PostCSS dependency
chain and require a breaking Next.js major-version migration.

Reference: [SheetJS Node.js installation documentation](https://docs.sheetjs.com/docs/getting-started/installation/nodejs/).
