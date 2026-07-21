import { mkdirSync } from "node:fs";
import { resolve } from "node:path";
import { expect, test, type Page } from "@playwright/test";
import * as XLSX from "xlsx";
import {
  accessTokenFor,
  cleanupStagingRun,
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
    if (run) await cleanupStagingRun(run);
  });

  test("protects private pages and completes the login/logout flow", async ({ page }) => {
    await page.goto("/dashboard");
    await expect(page).toHaveURL(/\/login$/);
    await expect(page.getByRole("heading", { name: "Sign in" })).toBeVisible();

    await page.getByRole("button", { name: "Sign in", exact: true }).click();
    await expect(page.getByText("Please enter an email and a password")).toBeVisible();

    await login(page, "admin");
    await expect(page.getByRole("heading", { name: "Dashboard", exact: true })).toBeVisible();
    await page.getByRole("link", { name: "Admin", exact: true }).click();
    await expect(page.getByRole("heading", { name: "User Access Management" })).toBeVisible();
    await expect(page.getByText(run.users.operator.email)).toBeVisible();
    await expect(page.getByText(run.users.viewer.email)).toBeVisible();
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

    const minStockUpdate = await request.post("/api/dashboard/min-stock", {
      headers: { Authorization: `Bearer ${operatorToken}` },
      data: { device_id: run.bin.id, min_stock: 2 },
    });
    expect(minStockUpdate.status()).toBe(200);
    expect((await minStockUpdate.json()).ok).toBe(true);

    await login(page, "viewer");
    await expect(page.getByRole("link", { name: "Dashboard" })).toBeVisible();
    await expect(page.getByRole("link", { name: "Receiving" })).toHaveCount(0);
    await expect(page.getByRole("link", { name: "Admin", exact: true })).toHaveCount(0);
    await page.goto("/admin");
    await expect(page).toHaveURL(/\/denied$/);
    await expect(page.getByText("Access denied")).toBeVisible();
    await signOut(page);
  });

  test("opens every operator module with the professional navigation", async ({ page }) => {
    await login(page, "operator");

    const modules = [
      ["/dashboard", "Dashboard"],
      ["/supply", "Supply Orders"],
      ["/inbound", "Inbound Processing"],
      ["/outbound", "Device Outbound"],
      ["/accessories", "Accessory Outbound"],
      ["/bins", "Inventory Setup"],
      ["/labels", "Warehouse Label Printing"],
      ["/returns", "Customer Returns"],
      ["/transfer", "Stock Transfer"],
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

  test("runs an IMEI through inbound, transfer, outbound and customer return", async ({ page }) => {
    await login(page, "operator");

    await page.goto("/inbound");
    await page.getByLabel("Inbound reference").fill(`E2E inbound ${run.stamp}`);
    await page.getByLabel("Manual inbound device").selectOption(run.bin.id);
    await page.getByLabel("Manual inbound box").fill(run.manualBox);
    await page.getByLabel("Manual inbound floor").selectOption("00");
    await page.getByLabel("Manual inbound IMEIs").fill(run.manualImei);
    await page.getByRole("button", { name: "Preview Manual Inbound" }).click();
    await expect(page.getByText("Manual Preview")).toBeVisible();
    await expect(page.getByText(/New:\s*1/)).toBeVisible();
    await page.getByRole("button", { name: "Confirm Inbound" }).click();
    await expect(page.getByText(/Manual inbound completed: 1 IMEIs imported/)).toBeVisible();

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
    await page.getByLabel("Outbound shipment reference").fill(`E2E-OUT-${run.stamp}`);
    await page.getByLabel("Outbound IMEIs").fill(run.manualImei);
    await page.getByRole("button", { name: "Preview Outbound" }).click();
    await expect(page.getByText("Preview (manual)")).toBeVisible();
    await page.getByRole("button", { name: "Confirm Outbound" }).click();
    await expect(page.getByText("Device outbound completed")).toBeVisible();
    expect((await readItem(run.manualImei))?.status).toBe("OUT");

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

    item = await readItem(run.manualImei);
    expect(item?.status).toBe("IN");
    expect(item?.boxes?.box_code).toBe(run.returnBox);
    await signOut(page);
  });

  test("imports inbound and outbound spreadsheets", async ({ page }) => {
    const file = spreadsheetPath(`quicklink-${run.stamp}.xlsx`);
    createQuicklinkSpreadsheet(file);
    await login(page, "operator");

    await page.goto("/inbound");
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
    await expect(page.getByRole("button", { name: "Download Labels" })).toBeVisible();
    expect((await readItem(run.spreadsheetImei))?.status).toBe("IN");

    await page.goto("/outbound");
    await page.getByLabel("Outbound shipment reference").fill(`E2E-XLSX-OUT-${run.stamp}`);
    await page.getByLabel("Outbound spreadsheet file").setInputFiles(file);
    await page.getByRole("button", { name: "Preview Spreadsheet" }).click();
    await expect(page.getByText("Preview (excel)")).toBeVisible();
    await page.getByRole("button", { name: "Confirm Outbound" }).click();
    await expect(page.getByText("Device outbound completed")).toBeVisible();
    expect((await readItem(run.spreadsheetImei))?.status).toBe("OUT");
    await signOut(page);
  });

  test("processes manual and spreadsheet accessory outbound", async ({ page }) => {
    const file = spreadsheetPath(`accessories-${run.stamp}.xlsx`);
    createAccessorySpreadsheet(file);
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

    await page.getByLabel("Accessory shipment reference").fill(`E2E-ACC-XLSX-${run.stamp}`);
    await page.getByLabel("Accessory spreadsheet file").setInputFiles(file);
    await page.getByRole("button", { name: "Preview Spreadsheet" }).click();
    await expect(page.getByText("Confirm Accessory Outbound")).toBeVisible();
    await page.getByRole("button", { name: "Confirm Outbound" }).click();
    await expect(page.getByText("Spreadsheet outbound completed")).toBeVisible();
    expect(await readAccessoryStock(run.accessory.id)).toBe(7);
    await signOut(page);
  });

  test("creates inventory, supply and label outputs", async ({ page }) => {
    await login(page, "operator");

    await page.goto("/bins");
    await page.getByPlaceholder("New device bin").fill(run.uiBinName);
    await page.getByRole("button", { name: "Add Bin" }).click();
    const binRow = page.getByRole("row", { name: new RegExp(run.uiBinName) });
    await expect(binRow).toBeVisible();
    await binRow.getByRole("button", { name: "Delete" }).click();
    await expect(binRow).toHaveCount(0);

    await page.goto("/supply");
    await page.getByRole("button", { name: "New Supply Order" }).click();
    await page.getByLabel("Supply origin office").selectOption("UK");
    await page.getByLabel("Supply destination office").selectOption("BE");
    await page.getByLabel("Supply item 1 type").selectOption("DEVICE");
    await page.getByLabel("Supply item 1 product").fill(run.bin.name);
    await page.getByLabel("Supply item 1 quantity").fill("3");
    await page.getByPlaceholder("Optional comment").fill(`E2E supply ${run.stamp}`);
    await page.getByRole("button", { name: "Create Supply Order" }).click();
    await page.getByPlaceholder("Search orders, tracking numbers, offices, or items").fill(run.bin.name);
    await expect(page.getByRole("row", { name: new RegExp(run.bin.name) })).toBeVisible();

    await page.goto("/labels");
    await page.getByLabel("Label 1 inventory bin").selectOption(run.bin.id);
    await page.getByLabel("Label 1 box number").fill(run.returnBox);
    await page.getByLabel("Label 1 IMEIs").fill(run.manualImei);
    const downloadPromise = page.waitForEvent("download");
    await page.getByRole("button", { name: "Download All Labels" }).click();
    const download = await downloadPromise;
    expect(download.suggestedFilename()).toMatch(/\.pdf$/);
    expect(await download.createReadStream()).not.toBeNull();
    await signOut(page);
  });

  test("starts and stops an NRD task", async ({ page }) => {
    await login(page, "operator");
    await page.goto("/nrd");
    await page.getByLabel("NRD task").selectOption("Training");
    await page.getByRole("button", { name: "Start Task" }).click();
    await expect(page.getByText("Task started")).toBeVisible();
    await expect(page.getByText("Active task").locator("..").getByText("Training")).toBeVisible();
    await page.getByRole("button", { name: "Stop Task" }).click();
    await expect(page.getByRole("heading", { name: "Confirm NRD End Time" })).toBeVisible();
    await page.getByRole("button", { name: "End Now" }).click();
    await expect(page.getByText("Task stopped")).toBeVisible();
    await signOut(page);
  });
});
