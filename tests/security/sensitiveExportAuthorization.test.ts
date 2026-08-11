import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const exportRoutes = [
  join(process.cwd(), "app/api/dashboard/export/route.ts"),
  join(process.cwd(), "app/api/dashboard/export-count-sheet/route.ts"),
];

describe("sensitive inventory export authorization", () => {
  it.each(exportRoutes)(
    "checks the raw inventory export capability before creating a service client: %s",
    (route) => {
      const source = readFileSync(route, "utf8");
      const handler = source.indexOf("export async function GET(req: Request)");
      const authorizationOffset = source.slice(handler).search(
        /authorizeCapabilityRequest\(\s*req,\s*"inventory\.export\.raw"\s*\)/
      );
      const authorization =
        authorizationOffset < 0 ? -1 : handler + authorizationOffset;
      const serviceClient = source.indexOf("supabaseService()", handler);
      const privilegedQuery = source.indexOf(
        '.from("stock_export_view")',
        handler
      );

      expect(handler).toBeGreaterThanOrEqual(0);
      expect(authorization).toBeGreaterThan(handler);
      expect(serviceClient).toBeGreaterThan(authorization);
      expect(privilegedQuery).toBeGreaterThan(serviceClient);
    }
  );

  it("uses an explicit projection for the global stock export", () => {
    const source = readFileSync(exportRoutes[0], "utf8");

    expect(source).toContain(
      '.select("item_id,floor,device,box_code,imei")'
    );
    expect(source).not.toContain('.select("*")');
  });
});
