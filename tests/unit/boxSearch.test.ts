import { describe, expect, it } from "vitest";
import { buildBoxSearchRows, extractBoxCodes } from "../../lib/box-search";

describe("dashboard box search", () => {
  it("splits pasted box IDs on lines, commas, semicolons and tabs only", () => {
    expect(
      extractBoxCodes({
        boxCodesText: "001-002\n 003-004 ,POD 12;\t55501\r\n\n",
      })
    ).toEqual(["001-002", "003-004", "POD 12", "55501"]);
  });

  it("removes duplicates case-insensitively and keeps the first spelling", () => {
    expect(
      extractBoxCodes({ boxCodes: ["pod-a", "POD-A", "Pod-B"] })
    ).toEqual(["pod-a", "Pod-B"]);
  });

  it("ignores malformed bodies", () => {
    expect(extractBoxCodes(null)).toEqual([]);
    expect(extractBoxCodes("001-002")).toEqual([]);
    expect(extractBoxCodes({ boxCodesText: " ,\n; " })).toEqual([]);
  });

  it("returns one row per matching box and a row for each missing ID", () => {
    const rows = buildBoxSearchRows(
      ["001-002", "missing", "pod-a"],
      [
        { id: "b2", box_code: "001-002", floor: "6", device: "FMC234" },
        { id: "b1", box_code: "001-002", floor: "1", device: "FMB140" },
        { id: "b3", box_code: "POD-A", floor: null, device: null },
      ],
      new Map([
        ["b1", 12],
        ["b2", 0],
      ])
    );

    expect(rows).toEqual([
      {
        query: "001-002",
        found: true,
        box_id: "001-002",
        device: "FMB140",
        location: "1",
        imei_count: 12,
      },
      {
        query: "001-002",
        found: true,
        box_id: "001-002",
        device: "FMC234",
        location: "6",
        imei_count: 0,
      },
      {
        query: "missing",
        found: false,
        box_id: null,
        device: null,
        location: null,
        imei_count: null,
      },
      {
        query: "pod-a",
        found: true,
        box_id: "POD-A",
        device: "Unknown",
        location: null,
        imei_count: 0,
      },
    ]);
  });
});
