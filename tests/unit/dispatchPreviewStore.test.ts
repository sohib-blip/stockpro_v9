import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { createDispatchPreviewToken } from "../../lib/dispatch-preview-token";
import { dispatchPreviewExpiresAt } from "../../lib/dispatch-preview-store";

const read = (path: string) => readFileSync(join(process.cwd(), path), "utf8");

describe("kept dispatch preview", () => {
  it("reads when the signed preview token expires", () => {
    process.env.SUPABASE_SERVICE_ROLE_KEY ||= "test-signing-secret";
    const before = Date.now();
    const token = createDispatchPreviewToken({
      sourceHash: "hash",
      sourceFilename: "Clé dispatch.xlsx",
      sourceGeneratedAt: null,
      orders: [],
    });
    const expiresAt = dispatchPreviewExpiresAt(token);
    expect(expiresAt).toBeGreaterThanOrEqual(before + 60 * 60 * 1000);
    expect(expiresAt).toBeLessThanOrEqual(Date.now() + 60 * 60 * 1000);
    expect(dispatchPreviewExpiresAt(undefined)).toBeNull();
    expect(dispatchPreviewExpiresAt("not-a-token")).toBeNull();
  });

  it("restores the preview only while that planning is open and ours", () => {
    const page = read("app/(app)/dispatch-planning/page.tsx");
    expect(page).toMatch(/plan\.id === stored\.planId[\s\S]*plan\.status === "OPEN"[\s\S]*plan\.locking[\s\S]*plan\.planner_id === stored\.userId/);
    expect(page).toContain("disabled={busy || !preview.ok || lockedByOther || previewExpired}");
    expect(page).toContain("onEnded={resetPreview}");
  });

  it("forgets the kept preview when it is cleared, confirmed or on sign-out", () => {
    const page = read("app/(app)/dispatch-planning/page.tsx");
    expect(page.match(/clearStoredDispatchPreview\(\)/g)?.length).toBeGreaterThanOrEqual(5);
    expect(read("components/AppShell.tsx")).toContain("await clearStoredDispatchPreview();");
    expect(read("components/AutoLogout.tsx")).toContain("await clearStoredDispatchPreview();");
  });
});
