import {
  ParseResult,
  makeFail,
  makeOk,
  DeviceMatch,
} from "./vendorParser";

export function parseDigitalMatterExcel(args: {
  rows: any[][];
  devicesDb: DeviceMatch[];
  location?: string;
}): ParseResult {
  const { rows } = args;

  if (!rows || rows.length === 0) {
    return makeFail(
      "Empty DigitalMatter Excel",
      [],
      { vendor: "digitalmatter" }
    );
  }

  return makeOk(
    [],
    {
      vendor: "digitalmatter",
      note: "DigitalMatter parser OK (placeholder)",
    },
    []
  );
}