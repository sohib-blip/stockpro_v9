import {
  ParseResult,
  makeFail,
  makeOk,
  DeviceMatch,
} from "./vendorParser";

export function parseTrusterExcel(args: {
  rows: any[][];
  devicesDb: DeviceMatch[];
  location?: string;
}): ParseResult {
  const { rows } = args;

  if (!rows || rows.length === 0) {
    return makeFail(
      "Empty Truster Excel",
      [],
      { vendor: "truster" }
    );
  }

  return makeOk(
    [],
    {
      vendor: "truster",
      note: "Truster parser OK (placeholder)",
    },
    []
  );
}