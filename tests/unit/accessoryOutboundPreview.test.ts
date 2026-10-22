import { describe, expect, it } from "vitest";
import {
  accessoryNameParts,
  spreadsheetSource,
} from "../../lib/accessory-outbound-preview";
import { translateUiText } from "../../lib/i18n";

describe("accessory outbound preview", () => {
  it("shows the product code under the accessory name", () => {
    expect(accessoryNameParts("BUZZER\t4")).toEqual(["BUZZER", "4"]);
    expect(accessoryNameParts("Atom Install Guide\tTBD001")).toEqual(["Atom Install Guide", "TBD001"]);
    expect(accessoryNameParts("TEST Velcro Strip")).toEqual(["TEST Velcro Strip", ""]);
  });

  it("explains where spreadsheet quantities come from", () => {
    expect(spreadsheetSource({ report_qty: 1, template_qty: 0 })).toBe("From report");
    expect(spreadsheetSource({ report_qty: 0, template_qty: 4 })).toBe("Automatic rule");
    expect(spreadsheetSource({ report_qty: 1, template_qty: 7 })).toBe("Report 1 + automatic rule 7");
  });

  it("translates the preview", () => {
    expect(translateUiText("fr", "Report 1 + automatic rule 7")).toBe("Rapport 1 + règle automatique 7");
    expect(translateUiText("fr", "17 units")).toBe("17 unités");
    expect(translateUiText("nl", "17 units")).toBe("17 eenheden");
  });
});
