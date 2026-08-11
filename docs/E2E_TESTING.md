# StockPro end-to-end testing

The Playwright suite exercises StockPro through the browser and its secured API
routes. It is intended for the isolated StockPro-Staging environment only.

## Safety guarantees

- The runner refuses to start unless the Supabase URL contains the approved
  staging project reference: `enjusebvcfjudrrnvjgl`.
- The target application must be localhost or a StockPro Vercel preview URL.
  The production hostname is explicitly rejected.
- Every user, IMEI, box, accessory, supply order and NRD entry created by the
  suite has a unique E2E identifier.
- Cleanup runs even when a scenario fails.
- No production credentials should ever be copied into the E2E environment.

## Local setup

Copy the example file and add the StockPro-Staging keys:

```bash
cp .env.e2e.example .env.e2e.local
```

`.env.e2e.local` is ignored by Git. Keep its service-role key private.

The default target is the local application on port 3001. Playwright starts it
with `NEXT_PUBLIC_APP_ENV=staging` and the isolated staging database.

## Commands

Run the browser suite:

```bash
npm run test:e2e
```

Run it with the browser visible:

```bash
npm run test:e2e:headed
```

Run all TypeScript, unit, build and E2E checks before a staging merge:

```bash
npm run check:staging
```

To test a deployed preview instead of localhost, set `E2E_BASE_URL` in
`.env.e2e.local` to the branch preview URL.

## Covered workflows

- Authentication, session takeover handling and sign-out
- Admin, operator and read-only access boundaries
- Every application module and professional navigation label
- Manual inbound, stock transfer, device outbound and customer return
- Spreadsheet inbound and spreadsheet device outbound
- Manual and spreadsheet accessory outbound
- Minimum-stock updates
- Inventory bin creation and deletion
- Supply-order creation
- PDF label generation and download
- NRD task start and stop
