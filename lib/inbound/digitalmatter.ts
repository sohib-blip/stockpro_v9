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
  const { rows, devicesDb, location } = args;

  if (!rows || rows.length === 0) {
    return makeFail("Empty DigitalMatter Excel", [], {
      vendor: "digitalmatter",
    });
  }

  const headerRowIndex = rows.findIndex((row) =>
    row.some((cell) =>
      String(cell ?? "")
        .toLowerCase()
        .includes("imei")
    )
  );

  if (headerRowIndex === -1) {
    return makeFail("DigitalMatter: IMEI column not found", [], {
      vendor: "digitalmatter",
      sample: rows.slice(0, 5),
    });
  }

  const headers = rows[headerRowIndex].map((h) =>
    String(h ?? "")
      .trim()
      .toLowerCase()
  );

  const dataRows = rows.slice(headerRowIndex + 1);

  const findCol = (names: string[]) =>
    headers.findIndex((h) =>
      names.some((name) => h.includes(name))
    );

  const imeiCol = findCol(["imei"]);
  const deviceCol = findCol([
    "product",
    "device",
    "model",
    "type",
    "name",
  ]);
  const boxCol = findCol([
    "box",
    "boxid",
    "box id",
    "carton",
    "package",
  ]);

  if (imeiCol === -1) {
    return makeFail("DigitalMatter: IMEI column not found", [], {
      vendor: "digitalmatter",
      headers,
    });
  }

  function norm(s: any) {
    return String(s ?? "")
      .trim()
      .toLowerCase();
  }

  function cleanImei(value: any) {
    const digits = String(value ?? "").replace(/\D/g, "");
    return digits.length === 15 ? digits : "";
  }

  function matchDevice(rawDevice: string) {
    const raw = norm(rawDevice);

    if (!raw) return null;

    return (
      devicesDb.find((d: any) => {
        const candidates = [
          d.device,
          d.canonical_name,
          d.name,
          d.label,
        ]
          .filter(Boolean)
          .map(norm);

        return candidates.some(
          (name) =>
            raw === name ||
            raw.includes(name) ||
            name.includes(raw)
        );
      }) || null
    );
  }

  const labelsByKey: Record<
    string,
    {
      device: string;
      box_no: string;
      floor?: string;
      imeis: string[];
    }
  > = {};

  const unknownDevices = new Set<string>();
  let fallbackBoxCounter = 1;

  for (const row of dataRows) {
    const imei = cleanImei(row[imeiCol]);
    if (!imei) continue;

    const rawDevice =
      deviceCol >= 0 ? String(row[deviceCol] ?? "").trim() : "";

    const matched = matchDevice(rawDevice);

    if (!matched) {
      if (rawDevice) unknownDevices.add(rawDevice);
      continue;
    }

    const deviceName =
      (matched as any).canonical_name ||
      (matched as any).device ||
      (matched as any).name ||
      rawDevice;

    let boxNo =
      boxCol >= 0 ? String(row[boxCol] ?? "").trim() : "";

    if (!boxNo) {
      boxNo = `DM-${String(fallbackBoxCounter).padStart(3, "0")}`;
    }

    const key = `${deviceName}|${boxNo}`;

    if (!labelsByKey[key]) {
      labelsByKey[key] = {
        device: deviceName,
        box_no: boxNo,
        floor: location,
        imeis: [],
      };
    }

    labelsByKey[key].imeis.push(imei);

    if (labelsByKey[key].imeis.length >= 50) {
      fallbackBoxCounter++;
    }
  }

  const labels = Object.values(labelsByKey).map((l) => ({
    ...l,
    imeis: Array.from(new Set(l.imeis)),
  }));

  if (unknownDevices.size > 0) {
    return makeFail(
      `DigitalMatter: unknown devices -> ${Array.from(unknownDevices).join(", ")}`,
      Array.from(unknownDevices),
      {
        vendor: "digitalmatter",
        headers,
      }
    );
  }

  if (labels.length === 0) {
    return makeFail("DigitalMatter: no valid IMEIs found", [], {
      vendor: "digitalmatter",
      headers,
      sample: rows.slice(0, 10),
    });
  }

  return makeOk(
  labels as any,
  {
    vendor: "digitalmatter",
    headers,
    total_boxes: labels.length,
    total_imeis: labels.reduce((sum: number, l: any) => sum + l.imeis.length, 0),
  },
  []
);
}