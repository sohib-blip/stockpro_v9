"use client";

import { createSupabaseBrowserClient } from "@/lib/supabase/client";
import { nrdTaskStopsAt } from "@/lib/nrd-time";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { ReactNode, useEffect, useMemo, useState } from "react";
import { Menu, X } from "lucide-react";
import { PermissionKey } from "@/lib/access-control";
import { useAccess } from "@/components/AccessProvider";
import PreferenceControls from "@/components/PreferenceControls";
import { usePreferences } from "@/components/PreferencesProvider";
import { apiFetch } from "@/lib/apiFetch";
import { signOutCurrentDevice } from "@/lib/session-control";
import { clearStoredDispatchPreview } from "@/lib/dispatch-preview-store";
import BrandLogo from "@/components/BrandLogo";

type NavItem = {
  href: string;
  label: string;
  permission: PermissionKey;
};

type PrimaryNav = {
  id: string;
  label: string;
  items: NavItem[];
};

const NAVIGATION: PrimaryNav[] = [
  {
    id: "dashboard",
    label: "Dashboard",
    items: [
      { href: "/dashboard", label: "Dashboard", permission: "can_dashboard" },
    ],
  },
  {
    id: "receiving",
    label: "Receiving",
    items: [
      { href: "/supply", label: "Supply Orders", permission: "can_supply" },
      {
        href: "/inbound",
        label: "Inbound Processing",
        permission: "can_inbound",
      },
    ],
  },
  {
    id: "outbound",
    label: "Outbound",
    items: [
      {
        href: "/outbound",
        label: "Device Outbound",
        permission: "can_outbound",
      },
      {
        href: "/accessories",
        label: "Accessory Outbound",
        permission: "can_accessories",
      },
      {
        href: "/dispatch-planning",
        label: "Dispatch Planning",
        permission: "can_outbound",
      },
    ],
  },
  {
    id: "inventory",
    label: "Inventory",
    items: [
      {
        href: "/bins",
        label: "Inventory Setup",
        permission: "can_bins",
      },
      {
        href: "/labels",
        label: "Label Printing",
        permission: "can_labels",
      },
    ],
  },
  {
    id: "operations",
    label: "Operations",
    items: [
      {
        href: "/returns",
        label: "Customer Returns",
        permission: "can_returns",
      },
      {
        href: "/transfer",
        label: "Stock Transfers",
        permission: "can_transfer",
      },
    ],
  },
  {
    id: "nrd",
    label: "NRD",
    items: [{ href: "/nrd", label: "NRD", permission: "can_nrd" }],
  },
  {
    id: "admin",
    label: "Admin",
    items: [
      { href: "/admin", label: "User Access", permission: "can_admin" },
      {
        href: "/admin/connections",
        label: "Connections",
        permission: "can_admin",
      },
    ],
  },
];

const NRD_POLL_INTERVAL_MS = 30_000;

type NrdBannerTask = {
  task: string;
  started_at: string;
  scheduled_end?: string | null;
};

function isActivePath(pathname: string, href: string) {
  return pathname === href || pathname.startsWith(`${href}/`);
}

function initialsFor(email: string | null) {
  if (!email) return "SP";
  const parts = email.split("@")[0].split(/[._-]+/).filter(Boolean);
  if (parts.length >= 2) return `${parts[0][0]}${parts[1][0]}`.toUpperCase();
  return email.slice(0, 2).toUpperCase();
}

export default function AppShell({ children }: { children: ReactNode }) {
  const pathname = usePathname() || "";
  const [activeNrd, setActiveNrd] = useState<NrdBannerTask | null>(null);
  const [mobileOpen, setMobileOpen] = useState(false);
  const { user, hasPermission } = useAccess();
  const email = user?.email ?? null;
  const canNrd = hasPermission("can_nrd");
  const { t } = usePreferences();
  const supabase = useMemo(() => createSupabaseBrowserClient(), []);
  const router = useRouter();

  const permittedNavigation = NAVIGATION.map((group) => ({
    ...group,
    items: group.items.filter((item) => hasPermission(item.permission)),
  })).filter((group) => group.items.length > 0);

  const activeGroup = permittedNavigation.find((group) =>
    group.items.some((item) => isActivePath(pathname, item.href))
  );
  const secondaryItems =
    activeGroup && activeGroup.items.length > 1 ? activeGroup.items : [];

  async function handleLogout() {
    await clearStoredDispatchPreview();
    await signOutCurrentDevice(supabase, window.sessionStorage);
    router.replace("/login");
    router.refresh();
  }

  useEffect(() => {
    setMobileOpen(false);
  }, [pathname]);

  // NRD banner: the signed-in user comes from AccessProvider. The current task
  // is checked every 30 s while the tab is visible, right away when the tab
  // becomes visible again, and when the task reaches its stop time.
  useEffect(() => {
    // Without NRD access the banner is not rendered (see showNrdBanner).
    if (!email || !canNrd) return;

    let cancelled = false;
    let stopTimer: ReturnType<typeof setTimeout> | undefined;

    function showActive(active: NrdBannerTask | null) {
      setActiveNrd(active);
      clearTimeout(stopTimer);
      if (!active?.started_at) return;
      const stopsAt = nrdTaskStopsAt(
        new Date(active.started_at),
        active.scheduled_end ? new Date(active.scheduled_end) : null
      ).at.getTime();
      // A couple of seconds after the stop time, so the server sees it passed.
      const delay = Math.max(0, stopsAt - Date.now()) + 2000;
      if (delay < 24 * 60 * 60 * 1000) stopTimer = setTimeout(loadNrd, delay);
    }

    async function loadNrd() {
      if (document.visibilityState === "hidden") return;
      try {
        const res = await apiFetch(
          `/api/nrd/current?user_email=${encodeURIComponent(email!)}&t=${Date.now()}`,
          { cache: "no-store" }
        );
        const json = await res.json();
        if (!cancelled && json.ok) showActive(json.active || null);
      } catch {
        // Keep the current banner; the next check tries again.
      }
    }

    void loadNrd();
    const interval = setInterval(loadNrd, NRD_POLL_INTERVAL_MS);
    const handleVisibility = () => {
      if (document.visibilityState === "visible") void loadNrd();
    };
    const handleNrdChanged = (event: Event) => {
      const detail = (event as CustomEvent<{ active: NrdBannerTask | null }>).detail;
      if (detail && "active" in detail) {
        showActive(detail.active || null);
        return;
      }
      void loadNrd();
    };
    document.addEventListener("visibilitychange", handleVisibility);
    window.addEventListener("stockpro:nrd-changed", handleNrdChanged);

    return () => {
      cancelled = true;
      clearTimeout(stopTimer);
      clearInterval(interval);
      document.removeEventListener("visibilitychange", handleVisibility);
      window.removeEventListener("stockpro:nrd-changed", handleNrdChanged);
    };
  }, [canNrd, email]);

  const showNrdBanner = Boolean(email && canNrd && activeNrd);

  return (
    <div className="app-shell">
      {showNrdBanner && activeNrd && (
        <Link href="/nrd" className="nrd-running-banner">
          <span aria-hidden="true">⏱</span>
          <span>
            {t("NRD task in progress:")} <strong>{activeNrd.task}</strong>
          </span>
          <span className="nrd-start-time">
            {new Date(activeNrd.started_at).toLocaleTimeString("en-GB", {
              hour: "2-digit",
              minute: "2-digit",
            })}
          </span>
          <span className="nrd-open-link">{t("Open NRD Tracking")}</span>
        </Link>
      )}

      <header className="topbar">
        <div className="topbar-inner">
          <Link href="/dashboard" className="brand-lockup" aria-label="StockPro">
            <BrandLogo tagline={t("Warehouse operations")} />
          </Link>

          <nav className="primary-nav" aria-label="Primary navigation">
            {permittedNavigation.map((group) => {
              const target = group.items[0]?.href ?? "/dashboard";
              const active = activeGroup?.id === group.id;
              return (
                <Link
                  key={group.id}
                  href={target}
                  className={`primary-nav-link ${active ? "is-active" : ""}`}
                  aria-current={active ? "page" : undefined}
                >
                  <span>{t(group.label)}</span>
                  {group.items.length > 1 && (
                    <span className="primary-nav-chevron" aria-hidden="true">▾</span>
                  )}
                </Link>
              );
            })}
          </nav>

          <div className="topbar-account">
            <PreferenceControls compact />
            {email && <span className="account-email">{email}</span>}
            <span className="account-avatar" aria-hidden="true">
              {initialsFor(email)}
            </span>
            <button type="button" className="signout-button" aria-label={t("Sign out")} onClick={handleLogout}>
              <span>{t("Sign out")}</span>
            </button>
          </div>

          <button
            type="button"
            className="mobile-menu-button"
            onClick={() => setMobileOpen((current) => !current)}
            aria-expanded={mobileOpen}
            aria-label={t(mobileOpen ? "Close navigation" : "Open navigation")}
          >
            {mobileOpen ? <X size={20} /> : <Menu size={20} />}
          </button>
        </div>

        {mobileOpen && (
          <div className="mobile-navigation">
            {permittedNavigation.map((group) => (
              <div key={group.id} className="mobile-nav-group">
                <div className="mobile-nav-label">{t(group.label)}</div>
                <div className="mobile-nav-items">
                  {group.items.map((item) => (
                    <Link
                      key={item.href}
                      href={item.href}
                      className={isActivePath(pathname, item.href) ? "is-active" : ""}
                    >
                      {t(item.label)}
                    </Link>
                  ))}
                </div>
              </div>
            ))}

            <div className="mobile-account-row">
              <PreferenceControls />
              <button type="button" className="signout-button" aria-label={t("Sign out")} onClick={handleLogout}>
                {t("Sign out")}
              </button>
            </div>
          </div>
        )}
      </header>

      {secondaryItems.length > 0 && (
        <nav className="secondary-nav" aria-label={`${t(activeGroup?.label || "")} navigation`}>
          <div className="secondary-nav-inner">
            {secondaryItems.map((item) => {
              const active = isActivePath(pathname, item.href);
              return (
                <Link
                  key={item.href}
                  href={item.href}
                  className={`secondary-nav-link ${active ? "is-active" : ""}`}
                  aria-current={active ? "page" : undefined}
                >
                  {t(item.label)}
                </Link>
              );
            })}
          </div>
        </nav>
      )}

      <main className="app-main">
        <div className="app-content">{children}</div>
      </main>
    </div>
  );
}
