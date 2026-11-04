import { createRequire } from "node:module";
import { describe, expect, it } from "vitest";

const require = createRequire(import.meta.url);
const {
  buildContentSecurityPolicy,
  buildSecurityHeaders,
} = require("../../lib/security-headers.cjs");
const nextConfig = require("../../next.config.js");

function directives(policy: string) {
  return new Map(
    policy.split("; ").map((part) => {
      const [name, ...values] = part.split(" ");
      return [name, values] as const;
    })
  );
}

const supabaseUrl = "https://enjuexample.supabase.co";

describe("security headers", () => {
  it("sends the security headers on every route, API included", async () => {
    const rules = await nextConfig.headers();
    expect(rules).toHaveLength(1);
    expect(rules[0].source).toBe("/:path*");
    const keys = rules[0].headers.map((header: { key: string }) => header.key);
    expect(keys).toEqual([
      "Content-Security-Policy",
      "X-Frame-Options",
      "X-Content-Type-Options",
      "Referrer-Policy",
      "Permissions-Policy",
    ]);
  });

  it("forbids framing, sniffing and full referrers", () => {
    const headers = new Map<string, string>(
      buildSecurityHeaders({ NODE_ENV: "production" }).map(
        (header: { key: string; value: string }) => [header.key, header.value]
      )
    );
    expect(headers.get("X-Frame-Options")).toBe("DENY");
    expect(headers.get("X-Content-Type-Options")).toBe("nosniff");
    expect(headers.get("Referrer-Policy")).toBe("strict-origin-when-cross-origin");
    expect(headers.get("Permissions-Policy")).toContain("camera=()");
  });

  it("allows only the app, Google Fonts and its own Supabase project in production", () => {
    const csp = directives(
      buildContentSecurityPolicy({ isDev: false, supabaseUrl })
    );
    expect(csp.get("default-src")).toEqual(["'self'"]);
    expect(csp.get("script-src")).toEqual(["'self'", "'unsafe-inline'"]);
    expect(csp.get("style-src")).toContain("https://fonts.googleapis.com");
    expect(csp.get("font-src")).toContain("https://fonts.gstatic.com");
    expect(csp.get("connect-src")).toEqual([
      "'self'",
      "https://enjuexample.supabase.co",
      "wss://enjuexample.supabase.co",
    ]);
    expect(csp.get("img-src")).toEqual(["'self'", "data:", "blob:"]);
    expect(csp.get("frame-ancestors")).toEqual(["'none'"]);
    expect(csp.get("frame-src")).toEqual(["'none'"]);
    expect(csp.get("object-src")).toEqual(["'none'"]);
    expect(csp.get("base-uri")).toEqual(["'self'"]);
    expect(csp.get("form-action")).toEqual(["'self'"]);
    expect(csp.has("upgrade-insecure-requests")).toBe(true);
  });

  it("allows eval only in development", () => {
    expect(buildContentSecurityPolicy({ isDev: false, supabaseUrl })).not.toContain(
      "unsafe-eval"
    );
    const dev = directives(buildContentSecurityPolicy({ isDev: true, supabaseUrl }));
    expect(dev.get("script-src")).toContain("'unsafe-eval'");
    expect(dev.has("upgrade-insecure-requests")).toBe(false);
  });

  it("allows the Vercel toolbar on preview deployments only", () => {
    expect(buildContentSecurityPolicy({ supabaseUrl })).not.toContain("vercel.live");
    const preview = directives(
      buildContentSecurityPolicy({ isVercelPreview: true, supabaseUrl })
    );
    expect(preview.get("script-src")).toContain("https://vercel.live");
    expect(preview.get("frame-src")).toEqual(["https://vercel.live"]);
    expect(preview.get("frame-ancestors")).toEqual(["'none'"]);
  });

  it("ignores a missing or invalid Supabase address", () => {
    for (const value of [undefined, "", "not a url"]) {
      const csp = directives(buildContentSecurityPolicy({ supabaseUrl: value }));
      expect(csp.get("connect-src")).toEqual(["'self'"]);
    }
  });
});
