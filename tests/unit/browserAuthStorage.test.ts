import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const source = readFileSync(
  join(process.cwd(), "lib/supabase/client.ts"),
  "utf8"
);

describe("browser authentication storage", () => {
  it("lets the Supabase SSR client synchronize auth cookies with middleware", () => {
    expect(source).toContain("createBrowserClient");
    expect(source).not.toContain("storage:");
    expect(source).not.toContain("window.sessionStorage");
  });
});
