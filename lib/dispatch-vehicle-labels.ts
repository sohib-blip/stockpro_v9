import { PDFDocument, StandardFonts, rgb } from "pdf-lib";
import type {
  DispatchParseIssue,
  DispatchSourceLine,
} from "./dispatch-planning";

export const L4731_COLUMNS = 7;
export const L4731_ROWS = 27;
export const L4731_LABELS_PER_PAGE = L4731_COLUMNS * L4731_ROWS;

export type DispatchVehicleLabel = {
  registration: string;
  deviceModel: string;
  orderId: string;
  sheet: string;
  row: number;
};

const MM_TO_POINTS = 72 / 25.4;
const PAGE_WIDTH_MM = 210;
const PAGE_HEIGHT_MM = 297;

// Measured from the supplied Avery Zweckform L4731 Word template.
const LEFT_MARGIN_MM = 9.91;
const TOP_MARGIN_MM = 13.49;
const LABEL_HEIGHT_MM = 9.98;
const LABEL_WIDTHS_MM = [25.4, 24.98, 24.98, 24.98, 24.98, 24.98, 24.98];
const COLUMN_GAPS_MM = [2.95, 2.96, 2.95, 2.95, 2.95, 2.95];

function mm(value: number) {
  return value * MM_TO_POINTS;
}

function printableRegistration(value: string) {
  return value.replace(/\s+/g, " ").trim();
}

export function buildDispatchVehicleLabels(lines: DispatchSourceLine[]) {
  const labels: DispatchVehicleLabel[] = [];
  const issues: DispatchParseIssue[] = [];

  for (const line of lines) {
    // One device source row represents one physical device. Repeated vehicle
    // registrations are intentionally retained when two devices go to the
    // same vehicle; accessory rows never enter this branch.
    if (!line.isDevice || !line.deviceModel) continue;

    const registration = printableRegistration(line.vehicleRegistration);
    if (!registration) {
      issues.push({
        sheet: line.sheet,
        row: line.row,
        hardwareType: line.hardwareType,
        deviceType: line.deviceType,
        message: "Vehicle Registration is required for every device label.",
      });
      continue;
    }
    if (registration.length > 80 || !/^[\x20-\x7e]+$/.test(registration)) {
      issues.push({
        sheet: line.sheet,
        row: line.row,
        hardwareType: line.hardwareType,
        deviceType: line.deviceType,
        message:
          "Vehicle Registration contains unsupported characters or is too long for an L4731 label.",
      });
      continue;
    }

    labels.push({
      registration,
      deviceModel: line.deviceModel,
      orderId: line.orderId,
      sheet: line.sheet,
      row: line.row,
    });
  }

  return { labels, issues };
}

function labelX(column: number) {
  let value = LEFT_MARGIN_MM;
  for (let index = 0; index < column; index += 1) {
    value += LABEL_WIDTHS_MM[index] + COLUMN_GAPS_MM[index];
  }
  return value;
}

export async function createDispatchVehicleLabelsPdf(
  labels: DispatchVehicleLabel[]
) {
  if (labels.length === 0) {
    throw new Error("No device vehicle registrations were found.");
  }

  const document = await PDFDocument.create();
  document.setTitle("StockPro Vehicle Registration Labels");
  document.setSubject("Avery Zweckform L4731 vehicle registration labels");
  document.setCreator("StockPro");
  document.setProducer("StockPro");
  const font = await document.embedFont(StandardFonts.HelveticaBold);
  const pageWidth = mm(PAGE_WIDTH_MM);
  const pageHeight = mm(PAGE_HEIGHT_MM);

  for (
    let pageStart = 0;
    pageStart < labels.length;
    pageStart += L4731_LABELS_PER_PAGE
  ) {
    const page = document.addPage([pageWidth, pageHeight]);
    const pageLabels = labels.slice(
      pageStart,
      pageStart + L4731_LABELS_PER_PAGE
    );

    pageLabels.forEach((label, index) => {
      const column = index % L4731_COLUMNS;
      const row = Math.floor(index / L4731_COLUMNS);
      const width = mm(LABEL_WIDTHS_MM[column]);
      const height = mm(LABEL_HEIGHT_MM);
      const x = mm(labelX(column));
      const y =
        pageHeight - mm(TOP_MARGIN_MM) - mm((row + 1) * LABEL_HEIGHT_MM);

      page.drawRectangle({
        x,
        y,
        width,
        height,
        borderColor: rgb(0.82, 0.82, 0.82),
        borderWidth: 0.3,
      });

      const maxTextWidth = width - mm(2);
      let fontSize = 8.5;
      while (
        fontSize > 5.5 &&
        font.widthOfTextAtSize(label.registration, fontSize) > maxTextWidth
      ) {
        fontSize -= 0.25;
      }
      const textWidth = font.widthOfTextAtSize(label.registration, fontSize);
      const textHeight = font.heightAtSize(fontSize, { descender: false });
      page.drawText(label.registration, {
        x: x + (width - textWidth) / 2,
        y: y + (height - textHeight) / 2 + 0.7,
        size: fontSize,
        font,
        color: rgb(0.07, 0.09, 0.13),
      });
    });
  }

  return Buffer.from(await document.save());
}
