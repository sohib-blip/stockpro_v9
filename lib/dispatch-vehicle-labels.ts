import JSZip from "jszip";
import type {
  DispatchParseIssue,
  DispatchSourceLine,
} from "./dispatch-planning";
import { L4731_TEMPLATE_BASE64 } from "./dispatch-vehicle-label-template";

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
    if (registration.length > 32 || !/^[\x20-\x7e]+$/.test(registration)) {
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

function escapeXml(value: string) {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

function registrationFontSizeHalfPoints(registration: string) {
  if (registration.length <= 10) return 20;
  if (registration.length <= 14) return 18;
  if (registration.length <= 18) return 16;
  if (registration.length <= 24) return 14;
  return 10;
}

function populateLabelCell(cellXml: string, registration: string) {
  const fontSize = registrationFontSizeHalfPoints(registration);
  let populated = cellXml
    .replace(/<w:bookmarkStart\b[^>]*\/>/g, "")
    .replace(/<w:bookmarkEnd\b[^>]*\/>/g, "")
    .replace(/<w:sz w:val="\d+"\/>/g, `<w:sz w:val="${fontSize}"/>`)
    .replace(/<w:szCs w:val="\d+"\/>/g, `<w:szCs w:val="${fontSize}"/>`);

  if (/<w:jc\b[^>]*\/>/.test(populated)) {
    populated = populated.replace(
      /<w:jc\b[^>]*\/>/,
      '<w:jc w:val="center"/>'
    );
  } else {
    populated = populated.replace(
      /<\/w:pPr>/,
      '<w:jc w:val="center"/></w:pPr>'
    );
  }

  const text = `<w:t xml:space="preserve">${escapeXml(registration)}</w:t>`;
  const withText = populated.replace(/<\/w:r>/, `${text}</w:r>`);
  if (withText === populated) {
    throw new Error("The supplied Word label template has no writable label run.");
  }
  return withText;
}

function populateTemplateTable(
  templateTable: string,
  labels: DispatchVehicleLabel[]
) {
  let rowIndex = 0;
  return templateTable.replace(/<w:tr(?:\s[^>]*)?>[\s\S]*?<\/w:tr>/g, (row) => {
    let cellIndex = 0;
    const populatedRow = row.replace(
      /<w:tc(?:\s[^>]*)?>[\s\S]*?<\/w:tc>/g,
      (cell) => {
        const currentCell = cellIndex;
        cellIndex += 1;
        if (currentCell % 2 !== 0) return cell;

        const labelIndex = rowIndex * L4731_COLUMNS + currentCell / 2;
        const label = labels[labelIndex];
        return label ? populateLabelCell(cell, label.registration) : cell;
      }
    );
    rowIndex += 1;
    return populatedRow;
  });
}

function renumberPageShapes(overlayParagraph: string, pageIndex: number) {
  const pageIdOffset = pageIndex * L4731_LABELS_PER_PAGE;
  return overlayParagraph.replace(
    /(<wp:docPr\b[^>]*\bid=")(\d+)(")/g,
    (_, prefix: string, id: string, suffix: string) =>
      `${prefix}${Number(id) + pageIdOffset}${suffix}`
  );
}

export async function createDispatchVehicleLabelsDocx(
  labels: DispatchVehicleLabel[]
) {
  if (labels.length === 0) {
    throw new Error("No device vehicle registrations were found.");
  }

  const archive = await JSZip.loadAsync(
    Buffer.from(L4731_TEMPLATE_BASE64, "base64")
  );
  const documentPart = archive.file("word/document.xml");
  if (!documentPart) {
    throw new Error("The supplied Word label template is missing document.xml.");
  }

  const documentXml = await documentPart.async("string");
  const tableMatch = documentXml.match(
    /<w:tbl(?:\s[^>]*)?>[\s\S]*?<\/w:tbl>/
  );
  if (!tableMatch) {
    throw new Error("The supplied Word label template has no label table.");
  }

  const tableStart = documentXml.indexOf(tableMatch[0]);
  const tableEnd = tableStart + tableMatch[0].length;
  const afterTable = documentXml.slice(tableEnd);
  const overlayMatch = afterTable.match(
    /^\s*(<w:p(?:\s[^>]*)?>[\s\S]*?<\/w:p>)/
  );
  const overlayParagraph = overlayMatch?.[1];
  if (
    !overlayParagraph ||
    (overlayParagraph.match(/<w:drawing(?:\s[^>]*)?>/g) ?? []).length !==
      L4731_LABELS_PER_PAGE ||
    (overlayParagraph.match(/<v:roundrect(?:\s[^>]*)?>/g) ?? []).length !==
      L4731_LABELS_PER_PAGE
  ) {
    throw new Error(
      "The supplied Word label template is missing the L4731 label outlines."
    );
  }

  const overlayStart =
    tableEnd + (overlayMatch?.[0].indexOf(overlayParagraph) ?? 0);
  const overlayEnd = overlayStart + overlayParagraph.length;

  const templateTable = tableMatch[0]
    .replace(/<w:bookmarkStart\b[^>]*\/>/g, "")
    .replace(/<w:bookmarkEnd\b[^>]*\/>/g, "");
  const pageContents: string[] = [];
  for (
    let pageStart = 0;
    pageStart < labels.length;
    pageStart += L4731_LABELS_PER_PAGE
  ) {
    const pageIndex = pageStart / L4731_LABELS_PER_PAGE;
    pageContents.push(
      `${populateTemplateTable(
        templateTable,
        labels.slice(pageStart, pageStart + L4731_LABELS_PER_PAGE)
      )}${renumberPageShapes(overlayParagraph, pageIndex)}`
    );
  }

  archive.file(
    "word/document.xml",
    `${documentXml.slice(0, tableStart)}${pageContents.join("")}${documentXml.slice(
      overlayEnd
    )}`
  );

  return archive.generateAsync({
    type: "nodebuffer",
    compression: "DEFLATE",
    compressionOptions: { level: 9 },
  });
}
