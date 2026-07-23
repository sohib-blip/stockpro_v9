import { mkdirSync } from "node:fs";
import { resolve } from "node:path";
import { expect, test, type Locator, type Page } from "@playwright/test";
import * as XLSX from "xlsx";
import {
  accessTokenFor,
  assertStagingRunClean,
  cleanupStagingRun,
  countInboundBatchesByReference,
  createStagingRun,
  readAccessoryStock,
  readItem,
  type StagingRun,
} from "./support/staging-run";

let run: StagingRun;

async function login(page: Page, role: "admin" | "operator" | "viewer") {
  const user = run.users[role];
  await page.goto("/login");
  await page.getByLabel("Email").fill(user.email);
  await page.getByLabel("Password").fill(user.password);
  await page.getByRole("button", { name: "Sign in", exact: true }).click();

  const takeover = page.getByRole("button", { name: "Take over session" });
  if (await takeover.isVisible({ timeout: 2_000 }).catch(() => false)) {
    await takeover.click();
  }

  await expect(page).toHaveURL(/\/dashboard$/);
  await expect(page.getByText("Test environment — do not process real inventory")).toBeVisible();
}

async function signOut(page: Page) {
  await page.getByRole("button", { name: "Sign out" }).click();
  await expect(page).toHaveURL(/\/login$/);
}

function spreadsheetPath(name: string) {
  const directory = resolve(process.cwd(), "test-results", "fixtures");
  mkdirSync(directory, { recursive: true });
  return resolve(directory, name);
}

function reportingMonth(offset: number) {
  const now = new Date();
  const date = new Date(now.getFullYear(), now.getMonth() - offset, 1);
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}`;
}

function createQuicklinkSpreadsheet(path: string) {
  const sheet = XLSX.utils.aoa_to_sheet([
    ["IMEI", "Carton"],
    [run.spreadsheetImei, `${run.bin.name}-${run.spreadsheetBox}`],
  ]);
  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook, sheet, "Inbound");
  XLSX.writeFile(workbook, path);
}

function createAccessorySpreadsheet(path: string) {
  const sheet = XLSX.utils.aoa_to_sheet([
    ["Item Type"],
    [run.accessory.name],
  ]);
  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook, sheet, "Outbound");
  XLSX.writeFile(workbook, path);
}

function createAutomaticAccessorySpreadsheet(path: string) {
  const sheet = XLSX.utils.aoa_to_sheet([
    ["IMEI"],
    [run.manualImei],
  ]);
  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook, sheet, "Automatic Accessories");
  XLSX.writeFile(workbook, path);
}

async function expectDownload(
  page: Page,
  trigger: Locator,
  filename: RegExp
) {
  const downloadPromise = page.waitForEvent("download");
  await trigger.click();
  const download = await downloadPromise;
  expect(download.suggestedFilename()).toMatch(filename);
  expect(await download.failure()).toBeNull();

  const stream = await download.createReadStream();
  expect(stream).not.toBeNull();
  let bytes = 0;
  for await (const chunk of stream!) bytes += chunk.length;
  expect(bytes).toBeGreaterThan(100);
}

test("persists the selected language and dark mode", async ({ page }) => {
  await page.goto("/login");

  await page.getByLabel("Choose language").selectOption("fr");
  await expect(page.getByRole("heading", { name: "Se connecter" })).toBeVisible();

  await page.getByLabel("Choisir la langue").selectOption("nl");
  await expect(page.getByRole("heading", { name: "Aanmelden" })).toBeVisible();

  await page.getByRole("button", { name: "Donkere modus inschakelen" }).click();
  await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");

  await page.reload();
  await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
  await expect(page.locator("html")).toHaveAttribute("lang", "nl");
  await expect(page.getByRole("heading", { name: "Aanmelden" })).toBeVisible();
});

test.describe.serial("StockPro staging end-to-end", () => {
  test.beforeAll(async () => {
    run = await createStagingRun();
  });

  test.afterAll(async () => {
    if (run) {
      await cleanupStagingRun(run);
      await assertStagingRunClean(run);
    }
  });

  test("protects private pages and completes the login/logout flow", async ({ page }) => {
    await page.goto("/dashboard");
    await expect(page).toHaveURL(/\/login$/);
    await expect(page.getByRole("heading", { name: "Sign in" })).toBeVisible();

    await page.getByRole("button", { name: "Sign in", exact: true }).click();
    await expect(page.getByText("Please enter an email and a password")).toBeVisible();

    await page.getByLabel("Email").fill(run.users.admin.email);
    await page.getByLabel("Password").fill("definitely-not-the-password");
    await page.getByRole("button", { name: "Sign in", exact: true }).click();
    await expect(page.getByText("Incorrect email or password")).toBeVisible();

    await login(page, "admin");
    await expect(page.getByRole("heading", { name: "Dashboard", exact: true })).toBeVisible();
    await page.getByRole("link", { name: "Admin", exact: true }).click();
    await expect(page.getByRole("heading", { name: "User Access" })).toBeVisible();
    await expect(page.getByText(run.users.operator.email)).toBeVisible();
    await expect(page.getByText(run.users.viewer.email)).toBeVisible();

    await page.getByRole("link", { name: "Connections", exact: true }).click();
    await expect(page.getByRole("heading", { name: "Connections" })).toBeVisible();
    await expect(page.locator(".connections-table")).toContainText(run.users.admin.email);
    await expect(page.locator(".connections-table")).toContainText("Successful");
    await expect(page.locator(".connections-table")).toContainText("Failed");
    await page.getByRole("link", { name: "User Access", exact: true }).click();

    const inviteCard = page.locator(".admin-invite-card");
    await inviteCard.getByPlaceholder("colleague@company.com").fill(run.inviteEmail);
    await inviteCard.locator("select").selectOption("viewer");
    await inviteCard.getByRole("button", { name: "Send Invitation" }).click();
    const invitationSent = page.getByText("Invitation sent and access configured");
    const invitationRateLimit = page.getByText(/email rate limit exceeded/i);
    await expect(invitationSent.or(invitationRateLimit)).toBeVisible();

    if (await invitationSent.isVisible()) {
      const invitedUser = page.locator("article").filter({ hasText: run.inviteEmail });
      await expect(invitedUser).toBeVisible();
      await invitedUser.locator("select").selectOption("operator");
      await invitedUser.getByRole("button", { name: "Save Changes" }).click();
      await expect(page.getByText(`Permissions saved for ${run.inviteEmail}`)).toBeVisible();
    } else {
      const viewerUser = page.locator("article").filter({ hasText: run.users.viewer.email });
      await viewerUser.locator("select").selectOption("operator");
      await viewerUser.getByRole("button", { name: "Save Changes" }).click();
      await expect(
        page.getByText(`Permissions saved for ${run.users.viewer.email}`)
      ).toBeVisible();
      await viewerUser.locator("select").selectOption("viewer");
      await viewerUser.getByRole("button", { name: "Save Changes" }).click();
      await expect(
        page.getByText(`Permissions saved for ${run.users.viewer.email}`)
      ).toBeVisible();
    }
    await signOut(page);
  });

  test("expires an older browser session after a secure takeover", async ({ browser }) => {
    const firstContext = await browser.newContext();
    const secondContext = await browser.newContext();
    const firstPage = await firstContext.newPage();
    const secondPage = await secondContext.newPage();

    try {
      await login(firstPage, "admin");

      const user = run.users.admin;
      await secondPage.goto("/login");
      await secondPage.getByLabel("Email").fill(user.email);
      await secondPage.getByLabel("Password").fill(user.password);
      await secondPage.getByRole("button", { name: "Sign in", exact: true }).click();
      await expect(
        secondPage.getByRole("button", { name: "Take over session" })
      ).toBeVisible();
      await secondPage.getByRole("button", { name: "Take over session" }).click();
      await expect(secondPage).toHaveURL(/\/dashboard$/);

      await expect(firstPage).toHaveURL(/\/login(?:\?reason=session-expired)?$/, {
        timeout: 35_000,
      });
      await expect(
        firstPage.getByText(
          "Your previous session was closed because this account signed in on another device."
        )
      ).toBeVisible();
      await secondPage.goto("/admin/connections");
      await expect(secondPage.locator(".connections-table")).toContainText(
        "Session takeover"
      );
      await signOut(secondPage);
    } finally {
      await firstContext.close();
      await secondContext.close();
    }
  });

  test("enforces viewer, operator and admin permissions in UI and APIs", async ({ page, request }) => {
    const viewerToken = await accessTokenFor(run.users.viewer);
    const operatorToken = await accessTokenFor(run.users.operator);

    const unauthenticated = await request.get("/api/dashboard/summary");
    expect(unauthenticated.status()).toBe(401);

    const viewerDashboard = await request.get("/api/dashboard/summary", {
      headers: { Authorization: `Bearer ${viewerToken}` },
    });
    expect(viewerDashboard.status()).toBe(200);

    const viewerAdmin = await request.get("/api/admin/users", {
      headers: { Authorization: `Bearer ${viewerToken}` },
    });
    expect(viewerAdmin.status()).toBe(403);

    const viewerStockExport = await request.get("/api/dashboard/export", {
      headers: { Authorization: `Bearer ${viewerToken}` },
    });
    expect(viewerStockExport.status()).toBe(403);

    const viewerCountSheet = await request.get(
      "/api/dashboard/export-count-sheet",
      { headers: { Authorization: `Bearer ${viewerToken}` } }
    );
    expect(viewerCountSheet.status()).toBe(403);

    const operatorStockExport = await request.get("/api/dashboard/export", {
      headers: { Authorization: `Bearer ${operatorToken}` },
    });
    expect(operatorStockExport.status()).toBe(200);

    const operatorCountSheet = await request.get(
      "/api/dashboard/export-count-sheet",
      { headers: { Authorization: `Bearer ${operatorToken}` } }
    );
    expect(operatorCountSheet.status()).toBe(200);

    const viewerRuleUpdate = await request.post("/api/bins/templates/save", {
      headers: { Authorization: `Bearer ${viewerToken}` },
      data: {
        device_id: run.bin.id,
        accessory_bin_id: run.accessory.id,
        quantity: 1,
        per_devices: 1,
      },
    });
    expect(viewerRuleUpdate.status()).toBe(403);

    const operatorRuleUpdate = await request.post("/api/bins/templates/save", {
      headers: { Authorization: `Bearer ${operatorToken}` },
      data: {
        device_id: run.bin.id,
        accessory_bin_id: run.accessory.id,
        quantity: 1,
        per_devices: 1,
      },
    });
    expect(operatorRuleUpdate.status()).toBe(200);
    expect((await operatorRuleUpdate.json()).ok).toBe(true);

    const minStockUpdate = await request.post("/api/dashboard/min-stock", {
      headers: { Authorization: `Bearer ${operatorToken}` },
      data: { device_id: run.bin.id, min_stock: 2 },
    });
    expect(minStockUpdate.status()).toBe(200);
    expect((await minStockUpdate.json()).ok).toBe(true);

    await login(page, "viewer");
    await expect(page.getByRole("link", { name: "Dashboard" })).toBeVisible();
    await expect(page.getByRole("button", { name: "Export Stock" })).toHaveCount(0);
    await expect(
      page.getByRole("button", { name: "Export Count Sheet" })
    ).toHaveCount(0);
    await expect(page.getByRole("link", { name: "Receiving" })).toHaveCount(0);
    await expect(page.getByRole("link", { name: "Admin", exact: true })).toHaveCount(0);
    await page.goto("/admin");
    await expect(page).toHaveURL(/\/denied$/);
    await expect(page.getByRole("heading", { name: "You don't have access to this page" })).toBeVisible();
    await signOut(page);
  });

  test("opens every operator module with the professional navigation", async ({ page }) => {
    await login(page, "operator");
    await expect(page.getByRole("button", { name: "Export Stock" })).toBeVisible();
    await expect(
      page.getByRole("button", { name: "Export Count Sheet" })
    ).toBeVisible();

    const modules = [
      ["/dashboard", "Dashboard"],
      ["/supply", "Supply Orders"],
      ["/inbound", "Inbound Processing"],
      ["/outbound", "Device Outbound"],
      ["/accessories", "Accessory Outbound"],
      ["/bins", "Inventory Setup"],
      ["/labels", "Label Printing"],
      ["/returns", "Customer Returns"],
      ["/transfer", "Stock Transfers"],
      ["/nrd", "NRD Tracking"],
    ] as const;

    for (const [path, heading] of modules) {
      await page.goto(path);
      await expect(page.getByRole("heading", { name: heading })).toBeVisible();
    }

    await page.goto("/admin");
    await expect(page).toHaveURL(/\/denied$/);
    await signOut(page);
  });

  test("shows every device bin on the dashboard without pagination", async ({
    page,
    request,
  }) => {
    const viewerToken = await accessTokenFor(run.users.viewer);
    const response = await request.get("/api/dashboard/bins", {
      headers: { Authorization: `Bearer ${viewerToken}` },
    });
    expect(response.status()).toBe(200);
    const payload = await response.json();

    await login(page, "viewer");

    await expect(page.locator(".device-table tbody tr")).toHaveCount(
      payload.rows.length
    );
    await expect(page.getByText(/device bins · all devices shown/)).toBeVisible();

    await signOut(page);
  });

  test("runs an IMEI through inbound, transfer, outbound and customer return", async ({ page }) => {
    const outboundReference = `E2E-OUT-${run.stamp}`;
    await login(page, "operator");

    await page.goto("/inbound");
    await page.getByLabel("Inbound reference").fill(`E2E inbound ${run.stamp}`);
    await page.getByLabel("Manual inbound device").selectOption(run.bin.id);
    await page.getByLabel("Manual inbound box").fill(run.manualBox);
    await page.getByLabel("Manual inbound floor").selectOption("00");
    await page.getByLabel("Manual inbound IMEIs").fill(run.manualImei);
    await page.getByRole("button", { name: "Preview Inbound" }).click();
    await expect(page.getByText("Preview ready — no blocking problems")).toBeVisible();
    await expect(page.getByText("1 valid")).toBeVisible();
    await page.getByRole("button", { name: "Confirm Inbound" }).click();
    await expect(page.getByText(/Manual inbound completed: 1 IMEIs imported/)).toBeVisible();
    await expectDownload(
      page,
      page.getByRole("button", { name: "Download batch Excel" }),
      /\.xlsx$/
    );
    await expectDownload(
      page,
      page.getByRole("button", { name: "Download ZD220 label PDF" }),
      /\.pdf$/
    );

    let item = await readItem(run.manualImei);
    expect(item?.status).toBe("IN");
    expect(item?.boxes?.box_code).toBe(run.manualBox);

    await page.goto("/transfer");
    await page.getByLabel("Transfer box codes").fill(run.manualBox);
    await page.getByLabel("Transfer source device").selectOption(run.bin.id);
    await page.getByLabel("Transfer destination floor").selectOption("1");
    await page.getByRole("button", { name: "Preview Transfer" }).click();
    await expect(page.getByText("Transfer Preview")).toBeVisible();
    await page.getByRole("button", { name: "Confirm Transfer" }).click();
    await expect(page.getByText("Transfer completed")).toBeVisible();

    item = await readItem(run.manualImei);
    expect(item?.boxes?.floor).toBe("1");

    await page.goto("/outbound");
    await page.getByLabel("Outbound shipment reference").fill(outboundReference);
    await page.getByLabel("Outbound IMEIs").fill(run.manualImei);
    await page.getByRole("button", { name: "Preview Outbound" }).click();
    await expect(page.getByText("Preview (manual)")).toBeVisible();
    await page.getByRole("button", { name: "Confirm Outbound" }).click();
    await expect(page.getByText("Device outbound completed")).toBeVisible();
    expect((await readItem(run.manualImei))?.status).toBe("OUT");
    const outboundRow = page.locator("#outbound-history tbody tr").filter({
      hasText: outboundReference,
    });
    await expect(outboundRow).toBeVisible();
    await expectDownload(
      page,
      outboundRow.getByRole("button", { name: "Download" }),
      /\.xlsx$/
    );

    await page.goto("/returns");
    await page.getByLabel("Return reference").fill(`E2E-RETURN-${run.stamp}`);
    await page.getByLabel("Return type").selectOption("cancellation_stop");
    await page.getByLabel("Return reason").selectOption("Other");
    await page.getByLabel("Return target box").fill(run.returnBox);
    await page.getByLabel("Return target floor").selectOption("00");
    await page.getByLabel("Returned IMEIs").fill(run.manualImei);
    await page.getByRole("button", { name: "Preview Return" }).click();
    await expect(page.getByText("Return Preview")).toBeVisible();
    await expect(page.getByText("Valid returns").locator("..").getByText("1")).toBeVisible();
    await page.getByRole("button", { name: "Confirm Return" }).click();
    await expect(page.getByText("Return completed: 1 IMEIs returned to stock.")).toBeVisible();
    await expect(
      page.locator("#returns-history tbody tr").filter({ hasText: `E2E-RETURN-${run.stamp}` })
    ).toBeVisible();
    await expectDownload(
      page,
      page.getByRole("button", { name: "Export all returns" }),
      /\.xlsx$/
    );

    item = await readItem(run.manualImei);
    expect(item?.status).toBe("IN");
    expect(item?.boxes?.box_code).toBe(run.returnBox);
    await signOut(page);
  });

  test("imports spreadsheets and blocks an all-duplicate inbound without history", async ({ page, request }) => {
    const file = spreadsheetPath(`quicklink-${run.stamp}.xlsx`);
    const outboundReference = `E2E-XLSX-OUT-${run.stamp}`;
    const duplicateReference = `E2E-XLSX-DUPLICATE-${run.stamp}`;
    createQuicklinkSpreadsheet(file);
    await login(page, "operator");

    await page.goto("/inbound");
    await page.getByRole("button", { name: "Spreadsheet Import" }).click();
    await page.getByLabel("Inbound reference").fill(`E2E spreadsheet ${run.stamp}`);
    await page.getByLabel("Inbound spreadsheet vendor").selectOption("quicklink");
    await page.getByLabel("Inbound spreadsheet file").setInputFiles(file);
    await page.getByLabel("Inbound spreadsheet floor").selectOption("00");
    await page.getByRole("button", { name: "Preview Import" }).click();
    await expect(page.getByText("Preview: 1 boxes • 1 IMEIs")).toBeVisible();

    page.once("dialog", async (dialog) => {
      expect(dialog.message()).toContain("Inbound completed");
      await dialog.accept();
    });
    await page.getByRole("button", { name: "Confirm Inbound" }).click();
    await expect(page.getByRole("button", { name: "Download ZD220 label PDF" })).toBeVisible();
    await expectDownload(
      page,
      page.getByRole("button", { name: "Download batch Excel" }),
      /\.xlsx$/
    );
    await expectDownload(
      page,
      page.getByRole("button", { name: "Download ZD220 label PDF" }),
      /\.pdf$/
    );
    expect((await readItem(run.spreadsheetImei))?.status).toBe("IN");

    await page.goto("/inbound");
    await page.getByRole("button", { name: "Spreadsheet Import" }).click();
    await page.getByLabel("Inbound reference").fill(duplicateReference);
    await page.getByLabel("Inbound spreadsheet vendor").selectOption("quicklink");
    await page.getByLabel("Inbound spreadsheet file").setInputFiles(file);
    await page.getByLabel("Inbound spreadsheet floor").selectOption("00");
    await page.getByRole("button", { name: "Preview Import" }).click();
    await expect(page.getByText("Import blocked — already in stock")).toBeVisible();
    await expect(page.getByText(/All 1 IMEI from this spreadsheet already exists in stock/)).toBeVisible();
    await expect(page.getByRole("button", { name: "Already in stock" })).toBeDisabled();

    const operatorToken = await accessTokenFor(run.users.operator);
    const duplicateResponse = await request.post("/api/inbound/confirm", {
      headers: { Authorization: `Bearer ${operatorToken}` },
      data: {
        labels: [
          {
            device_id: run.bin.id,
            box_no: run.spreadsheetBox,
            floor: "00",
            imeis: [run.spreadsheetImei],
          },
        ],
        vendor: "quicklink",
        shipment_ref: duplicateReference,
      },
    });
    expect(duplicateResponse.status()).toBe(409);
    const duplicateBody = await duplicateResponse.json();
    expect(duplicateBody.code).toBe("ALL_IMEIS_ALREADY_IN_STOCK");
    expect(duplicateBody.totals.inserted_imeis).toBe(0);
    expect(await countInboundBatchesByReference(duplicateReference)).toBe(0);

    await page.goto("/outbound");
    await page.getByRole("button", { name: "End-of-Day Report" }).click();
    await page.getByLabel("Outbound shipment reference").fill(outboundReference);
    await page.getByLabel("Outbound spreadsheet file").setInputFiles(file);
    await page.getByRole("button", { name: "Preview Spreadsheet" }).click();
    await expect(page.getByText("Preview (excel)")).toBeVisible();
    await page.getByRole("button", { name: "Confirm Outbound" }).click();
    await expect(page.getByText("Device outbound completed")).toBeVisible();
    expect((await readItem(run.spreadsheetImei))?.status).toBe("OUT");
    const outboundRow = page.locator("#outbound-history tbody tr").filter({
      hasText: outboundReference,
    });
    await expect(outboundRow).toBeVisible();
    await expectDownload(
      page,
      outboundRow.getByRole("button", { name: "Download" }),
      /\.xlsx$/
    );
    await signOut(page);
  });

  test("processes manual, explicit spreadsheet and automatic IMEI accessory outbound", async ({ page }) => {
    const explicitFile = spreadsheetPath(`accessories-explicit-${run.stamp}.xlsx`);
    const automaticFile = spreadsheetPath(`accessories-automatic-${run.stamp}.xlsx`);
    createAccessorySpreadsheet(explicitFile);
    createAutomaticAccessorySpreadsheet(automaticFile);
    await login(page, "operator");
    await page.goto("/accessories");

    await page.getByLabel("Accessory shipment reference").fill(`E2E-ACC-${run.stamp}`);
    await page.getByLabel("Accessory line 1").selectOption(run.accessory.id);
    await page.getByLabel("Accessory quantity 1").fill("2");
    await page.getByRole("button", { name: "Preview Outbound" }).click();
    await expect(page.getByText("Confirm Accessory Outbound")).toBeVisible();
    await page.getByRole("button", { name: "Confirm Outbound" }).click();
    await expect(page.getByText("Accessory outbound completed")).toBeVisible();
    expect(await readAccessoryStock(run.accessory.id)).toBe(8);

    await page.getByRole("button", { name: "Spreadsheet" }).click();
    await page.getByLabel("Accessory shipment reference").fill(`E2E-ACC-XLSX-${run.stamp}`);
    await page.getByLabel("Accessory spreadsheet file").setInputFiles(explicitFile);
    await page.getByRole("button", { name: "Preview Spreadsheet" }).click();
    await expect(page.getByText("Confirm Accessory Outbound")).toBeVisible();
    await page.getByRole("button", { name: "Confirm Outbound" }).click();
    await expect(page.getByText("Spreadsheet outbound completed")).toBeVisible();
    expect(await readAccessoryStock(run.accessory.id)).toBe(7);

    await page.getByLabel("Accessory shipment reference").fill(`E2E-ACC-AUTO-${run.stamp}`);
    await page.getByLabel("Accessory spreadsheet file").setInputFiles(automaticFile);
    await page.getByRole("button", { name: "Preview Spreadsheet" }).click();
    await expect(page.getByText("Confirm Accessory Outbound")).toBeVisible();
    await expect(
      page.locator(".prototype-preview-content").getByRole("cell", {
        name: run.accessory.name,
      })
    ).toBeVisible();
    await page.getByRole("button", { name: "Confirm Outbound" }).click();
    await expect(page.getByText("Spreadsheet outbound completed")).toBeVisible();
    expect(await readAccessoryStock(run.accessory.id)).toBe(6);
    await signOut(page);
  });

  test("exports dashboards and reports low device and accessory stock", async ({ page }) => {
    await login(page, "operator");

    await expectDownload(
      page,
      page.getByRole("button", { name: "Export Stock" }),
      /\.xlsx$/
    );
    await expectDownload(
      page,
      page.getByRole("button", { name: "Export Count Sheet" }),
      /\.xlsx$/
    );
    await expectDownload(
      page,
      page.getByRole("button", { name: "Export Accessories" }),
      /\.xlsx$/
    );

    await page.getByPlaceholder("Search device…").fill(run.bin.name);
    const deviceRow = page.locator(".device-table tbody tr").filter({ hasText: run.bin.name });
    await expect(deviceRow).toContainText("▼ LOW");

    await page.getByPlaceholder("Search accessory…").fill(run.accessory.name);
    const accessoryRow = page.locator(".accessory-table tbody tr").filter({
      hasText: run.accessory.name,
    });
    await expect(accessoryRow).toContainText("▼ LOW");
    await signOut(page);
  });

  test("manages inventory rules, supply lifecycles and label outputs", async ({ page }) => {
    await login(page, "operator");

    await page.goto("/bins");
    const existingBinRow = page.getByRole("row").filter({ hasText: run.bin.name });
    await expect(existingBinRow).toBeVisible();
    await existingBinRow.getByRole("button", { name: "Accessory Rules" }).click();
    await expect(
      page.getByText(`Automatic Accessory Rules for ${run.bin.name}`)
    ).toBeVisible();
    await expect(
      page.locator(".prototype-rules-layout tbody tr").filter({ hasText: run.accessory.name })
    ).toContainText("1");

    await page.getByRole("tab", { name: /Device Bins/ }).click();
    await page.getByPlaceholder("New device bin").fill(run.uiBinName);
    await page.getByRole("button", { name: "Add Bin" }).click();
    const binRow = page.getByRole("row", { name: new RegExp(run.uiBinName) });
    await expect(binRow).toBeVisible();
    await binRow.getByRole("button", { name: "Delete" }).click();
    await expect(binRow).toHaveCount(0);

    await page.goto("/supply");
    const supplySearch = page.getByPlaceholder("Search order or tracking…");

    async function createSupply(product: string, comment: string) {
      await supplySearch.fill("");
      await page.getByRole("button", { name: "+ New Order" }).click();
      await page.getByLabel("Supply origin office").selectOption("UK");
      await page.getByLabel("Supply destination office").selectOption("BE");
      await page.getByLabel("Supply item 1 type").selectOption("DEVICE");
      await page.getByLabel("Supply item 1 product").fill(product);
      await page.getByLabel("Supply item 1 quantity").fill("3");
      await page.getByPlaceholder("Optional comment").fill(comment);
      await page.getByRole("button", { name: "Create Supply Order" }).click();
      await supplySearch.fill(product);
      const row = page.getByRole("row").filter({ hasText: product });
      await expect(row).toBeVisible();
      return row;
    }

    async function updateSupplyStatus(
      product: string,
      status: "SHIPPED" | "RECEIVED" | "IMPORTED" | "FAILED",
      tracking?: string
    ) {
      await supplySearch.fill(product);
      const row = page.getByRole("row").filter({ hasText: product });
      await row.getByRole("button", { name: "Edit" }).click();
      const modal = page.locator(".fixed.inset-0.z-\\[80\\]");
      await modal.locator("select").nth(2).selectOption(status);
      if (tracking) {
        await modal.getByPlaceholder("Tracking number").fill(tracking);
      }
      if (status === "FAILED") {
        await modal.getByPlaceholder("Reason for failure").fill("E2E validation failure");
      }
      await modal.getByRole("button", { name: "Save Changes" }).click();
      if (status === "IMPORTED") {
        await page.getByRole("button", { name: "Mark as Imported" }).click();
      }
      await expect(row).toContainText(status);
    }

    await createSupply(run.bin.name, `E2E supply ${run.stamp}`);
    await expectDownload(
      page,
      page.getByRole("button", { name: "Export Excel" }),
      /\.xlsx$/
    );
    await updateSupplyStatus(run.bin.name, "SHIPPED", `TRACK-${run.stamp}`);
    await updateSupplyStatus(run.bin.name, "RECEIVED");
    await updateSupplyStatus(run.bin.name, "IMPORTED");

    const deleteProduct = `${run.bin.name}-DELETE`;
    const deleteRow = await createSupply(deleteProduct, `E2E delete ${run.stamp}`);
    await deleteRow.getByRole("button", { name: "Delete" }).click();
    await page.locator(".fixed.inset-0.z-\\[90\\]").getByRole("button", { name: "Delete" }).click();
    await expect(deleteRow).toHaveCount(0);

    const failedProduct = `${run.bin.name}-FAILED`;
    await createSupply(failedProduct, `E2E failure ${run.stamp}`);
    await updateSupplyStatus(failedProduct, "FAILED");

    await page.goto("/labels");
    await page.getByLabel("Label 1 inventory bin").selectOption(run.bin.id);
    await page.getByLabel("Label 1 box number").fill(run.returnBox);
    await page.getByLabel("Label 1 IMEIs").fill(run.manualImei);
    await expectDownload(
      page,
      page.getByRole("button", { name: /Download all labels — PDF/ }),
      /\.pdf$/
    );
    await signOut(page);
  });

  test("runs normal and corrected NRD sessions with personal and admin exports", async ({ page }) => {
    await login(page, "operator");
    await page.goto("/nrd");
    const monthSelect = page.getByLabel("NRD reporting month");
    await expect(monthSelect).toBeVisible();
    await expect(monthSelect.locator("option")).toHaveCount(60);
    const previousMonthHistory = page.waitForResponse((response) =>
      response.url().includes("/api/nrd/history") &&
      response.url().includes(`period_month=${reportingMonth(1)}`)
    );
    await monthSelect.selectOption(reportingMonth(1));
    await previousMonthHistory;
    await expect(monthSelect).toHaveValue(reportingMonth(1));
    await monthSelect.selectOption(reportingMonth(0));
    await expect(monthSelect).toHaveValue(reportingMonth(0));
    await page.getByLabel("NRD task", { exact: true }).selectOption("Training");
    await page.getByRole("button", { name: "Start Task" }).click();
    await expect(page.getByText("Task started")).toBeVisible();
    await expect(page.locator(".nrd-overview-card.active").getByText("Training", { exact: true })).toBeVisible();
    await page.getByRole("button", { name: "Stop now" }).click();
    await expect(page.getByText("Task stopped")).toBeVisible();

    await page.getByLabel("NRD task", { exact: true }).selectOption("Team Meeting");
    await page.getByRole("button", { name: "Start Task" }).click();
    await expect(page.getByText("Task started")).toBeVisible();
    await page.getByRole("button", { name: "Stop with corrected end time…" }).click();
    await expect(page.getByRole("heading", { name: "Confirm NRD End Time" })).toBeVisible();
    await page.getByRole("button", { name: "Save Corrected End Time" }).click();
    await expect(page.getByText("NRD corrected and stopped")).toBeVisible();

    await expectDownload(
      page,
      page.getByRole("button", { name: "My Excel export" }),
      /\.xlsx$/
    );
    await signOut(page);

    await login(page, "admin");
    await page.goto("/nrd");
    await expectDownload(
      page,
      page.getByRole("button", { name: "All users (admin)" }),
      /\.xlsx$/
    );
    await signOut(page);
  });
});
