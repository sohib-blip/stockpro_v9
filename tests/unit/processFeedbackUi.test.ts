import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const read = (...parts: string[]) =>
  readFileSync(join(process.cwd(), ...parts), "utf8");

describe("process confirmation feedback", () => {
  it("provides accessible success, error and information feedback", () => {
    const component = read("components", "ProcessFeedback.tsx");

    expect(component).toContain('role={kind === "error" ? "alert" : "status"}');
    expect(component).toContain('aria-live={kind === "error" ? "assertive" : "polite"}');
    expect(component).toContain('aria-atomic="true"');
    expect(component).toContain('aria-label="Dismiss notification"');
  });

  it("uses the shared feedback on every operational workflow", () => {
    for (const page of [
      "inbound",
      "outbound",
      "accessories",
      "transfer",
      "returns",
      "supply",
      "nrd",
      "labels",
      "bins",
      "admin",
      "dashboard",
    ]) {
      expect(read("app", "(app)", page, "page.tsx")).toContain(
        "ProcessFeedback"
      );
    }
  });

  it("keeps label errors visible and removes blocking native alerts", () => {
    const labels = read("app", "(app)", "labels", "page.tsx");
    const inbound = read("app", "(app)", "inbound", "page.tsx");
    const dashboard = read("app", "(app)", "dashboard", "page.tsx");
    const bins = read("app", "(app)", "bins", "page.tsx");

    expect(labels.indexOf("{feedback &&")).toBeLessThan(
      labels.indexOf('<div className="hidden">')
    );
    expect(inbound).not.toMatch(/\balert\s*\(/);
    expect(dashboard).not.toMatch(/window\.alert\s*\(/);
    expect(bins).not.toMatch(/\balert\s*\(/);
  });

  it("keeps operation confirmations visible until dismissed", () => {
    const outbound = read("app", "(app)", "outbound", "page.tsx");
    const transfer = read("app", "(app)", "transfer", "page.tsx");

    expect(outbound).not.toContain("setTimeout(() => setSuccess");
    expect(transfer).not.toContain("setTimeout(() => setSuccess");
    expect(outbound).toContain('title="Device outbound completed"');
    expect(transfer).toContain('title="Transfer completed"');
  });

  it("does not hard-code the staging label inside the login card", () => {
    const login = read("app", "(auth)", "login", "page.tsx");
    const layout = read("app", "layout.tsx");

    expect(login).not.toContain("auth-card-environment");
    expect(layout).toContain("<EnvironmentBanner />");
  });
});
