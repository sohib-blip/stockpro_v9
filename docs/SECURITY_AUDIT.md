# Security audit baseline

Date: 16 July 2026

Scope: static review of the `staging` code only. Production was not modified.

## Finding: API authentication coverage

The application currently contains 67 API route files:

- 4 routes contain an explicit request-authentication marker;
- 63 routes contain no explicit request-authentication marker;
- 65 routes initialize or use the Supabase service-role client;
- 61 service-role routes contain no explicit request-authentication marker.

This is the highest-priority security debt. Supabase service-role credentials
bypass Row Level Security, so a server route that uses them must authenticate
and authorize the caller before reading or changing data.

The automated security baseline now prevents the number of routes without an
authentication marker from increasing. This is a guardrail, not the final fix.

## Remediation plan

1. Add a shared authenticated API client in the browser.
2. Require a valid Supabase bearer token in every private API route.
3. Check the user's permissions for every write or export operation.
4. Migrate one business area at a time on staging: supply, inbound, outbound,
   transfers, returns, accessories, then dashboards and exports.
5. Reduce the baseline in `tests/security/apiAuthCoverage.test.ts` after each
   migrated route group.
6. Perform a separate RLS policy review before any production deployment.

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
