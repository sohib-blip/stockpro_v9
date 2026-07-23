"use client";

import { usePreferences } from "@/components/PreferencesProvider";
import { usePathname } from "next/navigation";
import { isAuthenticationRoute } from "@/lib/auth-routes";

export default function EnvironmentBanner() {
  const { t } = usePreferences();
  const pathname = usePathname() || "";
  const environment = process.env.NEXT_PUBLIC_APP_ENV || "production";
  if (environment === "production" || isAuthenticationRoute(pathname)) return null;

  return (
    <div className="environment-banner" role="status">
      {t("Test environment — do not process real inventory")}
    </div>
  );
}
