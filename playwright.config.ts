import { defineConfig, devices } from "@playwright/test";
import { loadE2EEnvironment, requireStagingEnvironment } from "./tests/e2e/support/environment";

loadE2EEnvironment();
const environment = requireStagingEnvironment();

process.env.NEXT_PUBLIC_SUPABASE_URL = environment.supabaseUrl;
process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = environment.anonKey;
process.env.SUPABASE_SERVICE_ROLE_KEY = environment.serviceRoleKey;
process.env.NEXT_PUBLIC_APP_ENV = "staging";
process.env.NEXT_PUBLIC_SITE_URL = environment.baseURL;

const usesLocalServer = new URL(environment.baseURL).hostname === "127.0.0.1" ||
  new URL(environment.baseURL).hostname === "localhost";

export default defineConfig({
  testDir: "./tests/e2e",
  testMatch: "**/*.spec.ts",
  outputDir: "test-results",
  fullyParallel: false,
  workers: 1,
  retries: process.env.CI ? 1 : 0,
  forbidOnly: Boolean(process.env.CI),
  timeout: 60_000,
  expect: { timeout: 15_000 },
  reporter: [
    ["list"],
    ["html", { outputFolder: "playwright-report", open: "never" }],
  ],
  use: {
    baseURL: environment.baseURL,
    trace: "on-first-retry",
    screenshot: "only-on-failure",
    video: "retain-on-failure",
  },
  projects: [
    {
      name: "chromium",
      use: { ...devices["Desktop Chrome"] },
    },
  ],
  webServer: usesLocalServer
    ? {
        command: "npm run dev -- --hostname 127.0.0.1 --port 3001",
        url: environment.baseURL,
        reuseExistingServer: !process.env.CI,
        timeout: 120_000,
        env: {
          ...process.env,
          NEXT_PUBLIC_SUPABASE_URL: environment.supabaseUrl,
          NEXT_PUBLIC_SUPABASE_ANON_KEY: environment.anonKey,
          SUPABASE_SERVICE_ROLE_KEY: environment.serviceRoleKey,
          NEXT_PUBLIC_APP_ENV: "staging",
          NEXT_PUBLIC_SITE_URL: environment.baseURL,
        },
      }
    : undefined,
});
