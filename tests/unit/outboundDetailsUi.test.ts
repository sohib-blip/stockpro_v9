import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const read = (path: string) => readFileSync(join(process.cwd(), path), "utf8");

describe("small outbound and setup details", () => {
  it("shows the Hidden badge on a background the light theme repaints", () => {
    const bins = read("app/(app)/bins/page.tsx");
    expect(bins).toContain('"bg-slate-800 text-slate-300"');
    expect(bins).not.toContain('"bg-slate-700 text-slate-300"');
    expect(read("app/globals.css")).toContain(':root[data-theme="light"] [class~="bg-slate-800"]');
  });

  it("says updated when an existing automatic rule is saved again", () => {
    const route = read("app/api/bins/templates/save/route.ts");
    expect(route).toContain("updated: (existing || []).length > 0");
    expect(read("app/(app)/bins/page.tsx")).toContain(
      '"Automatic accessory rule updated successfully."'
    );
  });

  it("uses the report file name as device outbound reference when none is typed", () => {
    const page = read("app/(app)/outbound/page.tsx");
    expect(page).toContain('shipmentRef.trim() || (previewSource === "excel" ? previewFileName : "")');
    expect(page).toContain("shipment_ref: reference || null");
  });

  it("empties the file fields after a confirm", () => {
    for (const path of ["app/(app)/outbound/page.tsx", "app/(app)/accessories/page.tsx"]) {
      const page = read(path);
      expect(page).toContain("key={fileInputKey}");
      expect(page).toContain("setFileInputKey((key) => key + 1);");
    }
  });
});
