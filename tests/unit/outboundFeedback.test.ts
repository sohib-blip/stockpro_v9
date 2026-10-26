import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { translateUiText } from "../../lib/i18n";
import { NO_SERVER_ANSWER, SPREADSHEET_UNREADABLE, snapshotFile } from "../../lib/outbound-feedback";

const page = (name: string) => readFileSync(join(process.cwd(), `app/(app)/${name}/page.tsx`), "utf8");

describe("outbound feedback", () => {
  it("keeps an in-memory copy of a readable spreadsheet", async () => {
    const file = new File([new Uint8Array([1, 2, 3])], "End Of Day.xlsx", { type: "application/test" });
    const copy = await snapshotFile(file);
    expect(copy?.name).toBe("End Of Day.xlsx");
    expect(Array.from(new Uint8Array(await copy!.arrayBuffer()))).toEqual([1, 2, 3]);
  });

  it("returns null when the spreadsheet cannot be read (open in Excel)", async () => {
    const locked = { name: "End Of Day.xlsx", type: "", arrayBuffer: () => Promise.reject(new Error("NotReadableError")) };
    expect(await snapshotFile(locked as unknown as File)).toBeNull();
  });

  it("confirms with the previewed bytes and shows errors next to the confirm buttons", () => {
    const accessories = page("accessories");
    expect(accessories).toContain('form.append("file", upload);');
    expect(accessories).toContain("file: upload,");
    expect(accessories).toContain('<p className="preview-confirm-error" role="alert">{confirmError}</p>');
    const outbound = page("outbound");
    expect(outbound).toContain('form.append("file", upload);');
    expect(outbound).toContain('<p className="preview-confirm-error" role="alert">{errorMsg}</p>');
  });

  it("translates the new messages", () => {
    expect(translateUiText("fr", SPREADSHEET_UNREADABLE)).toBe(
      "Le fichier n’a pas pu être lu. Fermez-le dans Excel (ou choisissez-le à nouveau), puis relancez l’aperçu."
    );
    expect(translateUiText("nl", NO_SERVER_ANSWER)).toBe(
      "Geen antwoord van de server. Controleer de geschiedenis voordat u het opnieuw probeert."
    );
  });
});
