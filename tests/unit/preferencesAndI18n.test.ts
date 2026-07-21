import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { LOCALES, translateUiText } from "../../lib/i18n";

describe("theme and language preferences", () => {
  it("supports English, French and Dutch without changing the English default", () => {
    expect(LOCALES).toEqual(["en", "fr", "nl"]);
    expect(translateUiText("en", "Supply Orders")).toBe("Supply Orders");
    expect(translateUiText("fr", "Supply Orders")).toBe(
      "Commandes d’approvisionnement"
    );
    expect(translateUiText("nl", "Supply Orders")).toBe("Bevoorradingsorders");
  });

  it("translates operational and dynamic interface labels", () => {
    expect(translateUiText("fr", "Confirm Outbound")).toBe(
      "Confirmer la sortie"
    );
    expect(translateUiText("nl", "Customer Returns")).toBe("Klantretouren");
    expect(translateUiText("fr", "Page 3")).toBe("Page 3");
    expect(translateUiText("nl", "Floor 6")).toBe("Verdieping 6");
  });

  it("persists device-local theme and locale choices", () => {
    const provider = readFileSync(
      join(process.cwd(), "components", "PreferencesProvider.tsx"),
      "utf8"
    );
    const layout = readFileSync(join(process.cwd(), "app", "layout.tsx"), "utf8");

    expect(provider).toContain('localStorage.setItem("stockpro-theme", theme)');
    expect(provider).toContain('localStorage.setItem("stockpro-locale", locale)');
    expect(layout).toContain('data-theme="light"');
  });
});
