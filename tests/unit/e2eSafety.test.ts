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
});
