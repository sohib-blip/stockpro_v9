// Device IDs stored in items.imei: every device has a 15-digit IMEI, except
// MatrixIQ, which has no IMEI and uses its 12-digit serial number instead.
// The database applies the same rule (stockpro_device_id_pattern).

export const IMEI_LENGTH = 15;
export const MATRIXIQ_SERIAL_LENGTH = 12;

// Names of the MatrixIQ devices, without spaces or punctuation.
const MATRIXIQ_NAMES = ["MATRIXIQ", "MATRIXTAGIQ"];

/** True for the MatrixIQ bin, whatever its spelling ("MatrixIQ", "Matrix-IQ", "Matrix TagiQ"). */
export function isMatrixIqBin(name: string | null | undefined) {
  const compact = String(name ?? "").toUpperCase().replace(/[^A-Z0-9]/g, "");
  return MATRIXIQ_NAMES.some((matrixName) => compact.includes(matrixName));
}

/** Number of digits of a device ID in this bin. */
export function deviceIdLength(binName: string | null | undefined) {
  return isMatrixIqBin(binName) ? MATRIXIQ_SERIAL_LENGTH : IMEI_LENGTH;
}

/** A 15-digit IMEI or a 12-digit MatrixIQ serial number. */
export function isDeviceId(value: string) {
  return /^(?:\d{15}|\d{12})$/.test(value);
}

/**
 * Device IDs typed, scanned or pasted in a text: every 15-digit run (as
 * before) and every standalone 12-digit number. Duplicates are kept.
 */
export function deviceIdsInText(text: string) {
  return Array.from(String(text ?? "").matchAll(/\d{15}|(?<!\d)\d{12}(?!\d)/g), (match) => match[0]);
}

/**
 * Error for device IDs that do not fit the bin: IMEIs in the MatrixIQ bin,
 * or 12-digit serial numbers in any other bin. Null when all IDs fit.
 */
export function deviceIdMismatch(binName: string | null | undefined, ids: string[]) {
  const expected = deviceIdLength(binName);
  const wrong = ids.filter((id) => id.length !== expected);
  if (wrong.length === 0) return null;
  const sample = wrong.slice(0, 5).join(", ") + (wrong.length > 5 ? ` (+${wrong.length - 5} more)` : "");
  return isMatrixIqBin(binName)
    ? `MatrixIQ uses 12-digit serial numbers, not 15-digit IMEIs. Import blocked: ${sample}`
    : `12-digit serial numbers are only accepted for MatrixIQ. Import blocked: ${sample}`;
}

/** Message when nothing valid was scanned for this bin. */
export function noDeviceIdsMessage(binName: string | null | undefined) {
  return isMatrixIqBin(binName)
    ? "No valid 12-digit serial numbers found."
    : "No valid 15-digit IMEIs found.";
}
