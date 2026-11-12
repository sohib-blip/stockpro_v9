import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

describe("Next.js proxy convention", () => {
  it("uses proxy.ts with a proxy export instead of the deprecated middleware", () => {
    const root = process.cwd();
    expect(existsSync(join(root, "middleware.ts"))).toBe(false);
    expect(existsSync(join(root, "lib", "middleware.ts"))).toBe(false);

    const proxy = readFileSync(join(root, "proxy.ts"), "utf8");
    expect(proxy).toContain("export async function proxy(");
    expect(proxy).not.toMatch(/export (async )?function middleware/);
    // The proxy always runs on Node.js; a runtime option would make the build fail.
    expect(proxy).not.toMatch(/export const runtime/);
    expect(proxy).toContain('matcher: ["/api/:path*", "/((?!_next|favicon.ico|api).*)"]');
  });
});
