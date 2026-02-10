import {
  ParseResult,
  makeFail,
  makeOk,
  DeviceMatch,
} from "./vendorParser";

export function parseQuicklinkExcel(args: {
  rows: any[][];
  devicesDb: DeviceMatch[];
  location?: string;
}): ParseResult {
  const { rows } = args;

  if (!rows || rows.length === 0) {
    return makeFail(
      "Empty Quicklink Excel",
      [],
      { vendor: "quicklink" }
    );
  }

  return makeOk(
    [],
    {
      vendor: "quicklink",
      note: "Quicklink parser OK (placeholder)",
    },
    []
  );
}