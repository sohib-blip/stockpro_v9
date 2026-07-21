"use client";

import { usePreferences } from "@/components/PreferencesProvider";

export default function EnvironmentBanner() {
  const { t } = usePreferences();
  const environment = process.env.NEXT_PUBLIC_APP_ENV || "production";
  if (environment === "production") return null;

  return (
    <div className="environment-banner" role="status">
      {t("Test environment — do not process real inventory")}
    </div>
  );
}
