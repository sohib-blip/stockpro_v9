"use client";

import { Globe2, Moon, Sun } from "lucide-react";
import { usePathname } from "next/navigation";
import { LOCALE_LABELS, Locale } from "@/lib/i18n";
import { usePreferences } from "@/components/PreferencesProvider";
import { isAuthenticationRoute } from "@/lib/auth-routes";

export default function PreferenceControls({ compact = false }: { compact?: boolean }) {
  const { locale, setLocale, t, theme, toggleTheme } = usePreferences();
  const themeLabel =
    theme === "light" ? t("Switch to dark mode") : t("Switch to light mode");

  return (
    <div className={`preference-controls ${compact ? "is-compact" : ""}`}>
      <label className="language-control" title={t("Choose language")}>
        <Globe2 size={15} aria-hidden="true" />
        <span className="sr-only">{t("Choose language")}</span>
        <select
          aria-label={t("Choose language")}
          value={locale}
          onChange={(event) => setLocale(event.target.value as Locale)}
        >
          {(Object.entries(LOCALE_LABELS) as Array<[Locale, string]>).map(
            ([value, label]) => (
              <option key={value} value={value}>
                {compact ? value.toUpperCase() : label}
              </option>
            )
          )}
        </select>
      </label>

      <button
        type="button"
        className="theme-toggle"
        aria-label={themeLabel}
        title={themeLabel}
        onClick={toggleTheme}
      >
        {theme === "light" ? (
          <Moon size={16} aria-hidden="true" />
        ) : (
          <Sun size={16} aria-hidden="true" />
        )}
      </button>
    </div>
  );
}

export function AuthPreferenceControls() {
  const pathname = usePathname() || "";
  if (!isAuthenticationRoute(pathname)) return null;
  return (
    <div className="auth-preferences">
      <PreferenceControls />
    </div>
  );
}
