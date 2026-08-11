import * as XLSX from "xlsx";
import { PayloadTooLargeError } from "./request-budget";

export type XlsxEnvelopeLimits = {
  maxCompressedBytes: number;
  maxExpandedBytes: number;
  maxEntries: number;
  maxEntryBytes: number;
  maxCompressionRatio: number;
};

export type WorkbookShapeLimits = {
  maxSheets: number;
  maxRowsPerSheet: number;
  maxCells: number;
};

const EOCD_SIGNATURE = 0x06054b50;
const CENTRAL_DIRECTORY_SIGNATURE = 0x02014b50;
const MAX_EOCD_SEARCH = 65_557;
const ZIP64_SENTINEL = 0xffff;
const ZIP64_SIZE_SENTINEL = 0xffffffff;

function findEndOfCentralDirectory(buffer: Buffer) {
  const lowerBound = Math.max(0, buffer.length - MAX_EOCD_SEARCH);

  for (let offset = buffer.length - 22; offset >= lowerBound; offset--) {
    if (buffer.readUInt32LE(offset) === EOCD_SIGNATURE) return offset;
  }

  throw new PayloadTooLargeError("Invalid XLSX ZIP envelope");
}

export function inspectXlsxZipEnvelope(
  buffer: Buffer,
  limits: XlsxEnvelopeLimits
) {
  if (buffer.length > limits.maxCompressedBytes) {
    throw new PayloadTooLargeError("Workbook exceeds the compressed-size limit");
  }

  if (buffer.length < 22) {
    throw new PayloadTooLargeError("Invalid XLSX ZIP envelope");
  }

  const eocd = findEndOfCentralDirectory(buffer);
  const diskNumber = buffer.readUInt16LE(eocd + 4);
  const centralDisk = buffer.readUInt16LE(eocd + 6);
  const entriesOnDisk = buffer.readUInt16LE(eocd + 8);
  const totalEntries = buffer.readUInt16LE(eocd + 10);
  const centralSize = buffer.readUInt32LE(eocd + 12);
  const centralOffset = buffer.readUInt32LE(eocd + 16);

  if (
    diskNumber !== 0 ||
    centralDisk !== 0 ||
    entriesOnDisk !== totalEntries ||
    totalEntries === ZIP64_SENTINEL ||
    centralSize === ZIP64_SIZE_SENTINEL ||
    centralOffset === ZIP64_SIZE_SENTINEL
  ) {
    throw new PayloadTooLargeError("Unsupported XLSX ZIP envelope");
  }

  if (totalEntries === 0 || totalEntries > limits.maxEntries) {
    throw new PayloadTooLargeError("Workbook contains too many ZIP entries");
  }

  if (
    centralOffset < 0 ||
    centralSize < 0 ||
    centralOffset + centralSize > eocd
  ) {
    throw new PayloadTooLargeError("Invalid XLSX central directory");
  }

  let offset = centralOffset;
  let expandedBytes = 0;

  for (let entry = 0; entry < totalEntries; entry++) {
    if (
      offset + 46 > buffer.length ||
      buffer.readUInt32LE(offset) !== CENTRAL_DIRECTORY_SIGNATURE
    ) {
      throw new PayloadTooLargeError("Invalid XLSX central directory");
    }

    const flags = buffer.readUInt16LE(offset + 8);
    const compressionMethod = buffer.readUInt16LE(offset + 10);
    const compressedBytes = buffer.readUInt32LE(offset + 20);
    const uncompressedBytes = buffer.readUInt32LE(offset + 24);
    const fileNameLength = buffer.readUInt16LE(offset + 28);
    const extraLength = buffer.readUInt16LE(offset + 30);
    const commentLength = buffer.readUInt16LE(offset + 32);

    if (
      compressedBytes === ZIP64_SIZE_SENTINEL ||
      uncompressedBytes === ZIP64_SIZE_SENTINEL ||
      (flags & 0x1) !== 0 ||
      (compressionMethod !== 0 && compressionMethod !== 8)
    ) {
      throw new PayloadTooLargeError("Unsupported XLSX ZIP entry");
    }

    if (uncompressedBytes > limits.maxEntryBytes) {
      throw new PayloadTooLargeError("Workbook ZIP entry is too large");
    }

    const ratio =
      uncompressedBytes === 0
        ? 0
        : uncompressedBytes / Math.max(1, compressedBytes);
    if (ratio > limits.maxCompressionRatio) {
      throw new PayloadTooLargeError("Workbook compression ratio is too high");
    }

    expandedBytes += uncompressedBytes;
    if (expandedBytes > limits.maxExpandedBytes) {
      throw new PayloadTooLargeError("Workbook expands beyond the size limit");
    }

    offset += 46 + fileNameLength + extraLength + commentLength;
  }

  if (offset > centralOffset + centralSize) {
    throw new PayloadTooLargeError("Invalid XLSX central directory size");
  }

  return {
    entries: totalEntries,
    compressedBytes: buffer.length,
    expandedBytes,
  };
}

export function measureWorkbookShape(
  workbook: XLSX.WorkBook,
  limits: WorkbookShapeLimits
) {
  if (workbook.SheetNames.length > limits.maxSheets) {
    throw new PayloadTooLargeError("Workbook contains too many sheets");
  }

  let rows = 0;
  let cells = 0;

  for (const sheetName of workbook.SheetNames) {
    const sheet = workbook.Sheets[sheetName];
    const reference = sheet?.["!ref"];
    if (!reference) continue;

    let range: XLSX.Range;
    try {
      range = XLSX.utils.decode_range(reference);
    } catch {
      throw new PayloadTooLargeError("Workbook contains an invalid sheet range");
    }

    const sheetRows = range.e.r - range.s.r + 1;
    const sheetColumns = range.e.c - range.s.c + 1;
    const sheetCells = sheetRows * sheetColumns;

    if (
      !Number.isSafeInteger(sheetCells) ||
      sheetRows > limits.maxRowsPerSheet
    ) {
      throw new PayloadTooLargeError("Workbook dimensions exceed the row limit");
    }

    rows += sheetRows;
    cells += sheetCells;
    if (cells > limits.maxCells) {
      throw new PayloadTooLargeError("Workbook dimensions exceed the cell limit");
    }
  }

  return { sheets: workbook.SheetNames.length, rows, cells };
}
