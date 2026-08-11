import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const root = process.cwd();
const environment = readFileSync(
  join(root, "tests/e2e/support/environment.ts"),
  "utf8"
);
const stagingRun = readFileSync(
  join(root, "tests/e2e/support/staging-run.ts"),
  "utf8"
);
const cloneScript = readFileSync(
  join(root, "scripts/clone-production-data-to-staging.mjs"),
  "utf8"
);
const gitignore = readFileSync(join(root, ".gitignore"), "utf8");

describe("E2E staging safety", () => {
  it("pins the approved staging project and rejects production targets", () => {
    expect(environment).toContain('STOCKPRO_STAGING_PROJECT_REF = "enjusebvcfjudrrnvjgl"');
    expect(environment).toContain("supabaseTarget.hostname !== `${STOCKPRO_STAGING_PROJECT_REF}.supabase.co`");
    expect(environment).toContain('target.hostname !== "stockpro-v9.vercel.app"');
    expect(environment).toContain("E2E safety stop");
  });

  it("keeps credentials and generated reports out of Git", () => {
    expect(gitignore).toContain(".env.e2e.local");
    expect(gitignore).toContain("playwright-report/");
    expect(gitignore).toContain("test-results/");
  });

  it("scopes destructive box cleanup to the unique E2E bin", () => {
    expect(stagingRun).toContain('.eq("bin_id", run.bin.id)');
    expect(stagingRun).toContain("run.manualBox");
    expect(stagingRun).toContain("run.returnBox");
  });

  it("removes legacy movement references before deleting the E2E bin", () => {
    expect(stagingRun).toContain(
      'from("movements").delete().eq("device_id", run.bin.id)'
    );
  });

  it("backs up and clears only the pinned Staging project", () => {
    expect(cloneScript).toContain(
      'const PRODUCTION_PROJECT_REF = "tqoblbwvvvqmwlsfoxni"'
    );
    expect(cloneScript).toContain(
      'const STAGING_PROJECT_REF = "enjusebvcfjudrrnvjgl"'
    );
    expect(cloneScript).toContain(
      'assertProject(staging, STAGING_PROJECT_REF, "Staging")'
    );
    expect(cloneScript).toContain(
      'throw new Error("Safety stop: Production and Staging URLs are identical")'
    );
    expect(cloneScript).toContain("staging-backup-before-clear-");
    expect(cloneScript).toContain("LEGACY_PRODUCTION_SNAPSHOT_TABLES");
    expect(cloneScript).toContain('"device_stock"');
    expect(cloneScript).toContain(
      "[...COPY_ORDER, ...LEGACY_PRODUCTION_SNAPSHOT_TABLES]"
    );
    expect(cloneScript).toContain('command === "clear-staging"');
    expect(cloneScript).toContain(
      "Staging business and technical data cleared; Production was read-only"
    );
  });
});
