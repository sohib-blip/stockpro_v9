// Shared feedback for the outbound pages when a spreadsheet or the server
// cannot be reached, so nothing ever fails without a message.

export const SPREADSHEET_UNREADABLE =
  "The spreadsheet could not be read. Close it in Excel (or choose it again), then preview it again.";

export const NO_SERVER_ANSWER =
  "No answer from the server. Check the history before trying again.";

/**
 * Reads the chosen file now and returns an in-memory copy, so confirming
 * later sends exactly the previewed bytes even if the file is opened or
 * changed in Excel meanwhile. Null when the file cannot be read.
 */
export async function snapshotFile(file: File): Promise<File | null> {
  try {
    return new File([await file.arrayBuffer()], file.name, { type: file.type });
  } catch {
    return null;
  }
}
