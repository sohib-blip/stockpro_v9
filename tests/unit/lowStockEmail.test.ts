import { describe, expect, it } from "vitest";
import {
  buildLowStockEmail,
  escapeHtml,
} from "../../lib/cron/lowStockEmail";

describe("low-stock email rendering", () => {
  it("escapes every HTML metacharacter", () => {
    expect(escapeHtml(`<>&"'`)).toBe("&lt;&gt;&amp;&quot;&#39;");
  });

  it("renders database values as text instead of trusted email markup", () => {
    const payload =
      `</b><a href="https://example.invalid/verify">Review stock</a><b>`;
    const email = buildLowStockEmail([
      {
        device: payload,
        imei_count: `<img src=x onerror=alert(1)>`,
        min_stock: `10 & "urgent"`,
      },
    ]);

    expect(email.html).not.toContain("<a ");
    expect(email.html).not.toContain("<img ");
    expect(email.html).toContain("&lt;/b&gt;&lt;a href=");
    expect(email.html).toContain("&lt;img src=x onerror=alert(1)&gt;");
    expect(email.html).toContain("10 &amp; &quot;urgent&quot;");
    expect(email.text).toContain(payload);
  });

  it("preserves the legitimate low-stock summary", () => {
    const email = buildLowStockEmail([
      { device: "FMC130", imei_count: 12, min_stock: 20 },
    ]);

    expect(email.subject).toBe("Low Stock Alert — 1 item");
    expect(email.html).toContain("<b>FMC130</b> — IN 12 ≤ MIN 20");
    expect(email.text).toContain("FMC130 — IN 12 ≤ MIN 20");
  });
});
