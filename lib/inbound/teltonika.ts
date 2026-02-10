import {
  ParseResult,
  makeFail,
  makeOk,
  DeviceMatch,
} from "./vendorParser";

export function parseTeltonikaExcel(args: {
  rows: any[][];
  devicesDb: DeviceMatch[];
  format?: string;
  location?: string;
}): ParseResult {
  const { rows, format } = args;

  if (!rows || rows.length === 0) {
    return makeFail(
      "Empty Teltonika Excel",
      [],
      { vendor: "teltonika", format }
    );
  }

  // ⚠️ Placeholder volontaire
  // La vraie logique Teltonika sera branchée après
  return makeOk(
    [],
    {
      vendor: "teltonika",
      format,
      note: "Teltonika parser OK (placeholder)",
    },
    []
  );
}