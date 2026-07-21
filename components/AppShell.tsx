"use client";

import { createSupabaseBrowserClient } from "@/lib/supabase/client";
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
    items: [{ href: "/admin", label: "User Access", permission: "can_admin" }],
  },
];

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
  const [email, setEmail] = useState<string | null>(null);
  const [activeNrd, setActiveNrd] = useState<any>(null);
  const [mobileOpen, setMobileOpen] = useState(false);
  const { hasPermission } = useAccess();
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
    await signOutCurrentDevice(supabase, window.sessionStorage);
    router.replace("/login");
    router.refresh();
  }

  useEffect(() => {
    setMobileOpen(false);
  }, [pathname]);

  useEffect(() => {
    async function loadUserAndNrd() {
      const { data } = await supabase.auth.getUser();
      const user = data?.user;
      setEmail(user?.email || null);

      if (user?.email && hasPermission("can_nrd")) {
        const res = await apiFetch(
          `/api/nrd/current?user_email=${encodeURIComponent(user.email)}&t=${Date.now()}`,
          { cache: "no-store" }
        );
        const json = await res.json();
        if (json.ok) setActiveNrd(json.active || null);
      } else {
        setActiveNrd(null);
      }
    }

    loadUserAndNrd();
    const interval = setInterval(loadUserAndNrd, 5000);
    const handleNrdChanged = (event: Event) => {
      const detail = (event as CustomEvent<{ active: unknown }>).detail;
      if (detail && "active" in detail) {
        setActiveNrd(detail.active || null);
        return;
      }
      loadUserAndNrd();
    };
    window.addEventListener("stockpro:nrd-changed", handleNrdChanged);

    return () => {
      clearInterval(interval);
      window.removeEventListener("stockpro:nrd-changed", handleNrdChanged);
    };
  }, [hasPermission, supabase]);

  return (
    <div className="app-shell">
      {activeNrd && (
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
            <span className="brand-name">StockPro</span>
            <span className="brand-description">{t("Warehouse operations")}</span>
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
            <button type="button" className="signout-button" onClick={handleLogout}>
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
              <button type="button" className="signout-button" onClick={handleLogout}>
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
