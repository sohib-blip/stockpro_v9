"use client";

import { createSupabaseBrowserClient } from "@/lib/supabase/client";
import { getUserRole } from "@/lib/getUserRoles";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { ReactNode, useEffect, useState } from "react";
import {
  ArrowDownToLine,
  ArrowUpFromLine,
  Boxes,
  LayoutDashboard,
  LogOut,
  Repeat,
  ShieldCheck,
  Timer,
} from "lucide-react";

type NavTab = {
  href: string;
  label: string;
};

type NavGroup = {
  href: string;
  label: string;
  icon: typeof LayoutDashboard;
  tabs?: NavTab[];
  adminOnly?: boolean;
};

const NAV_GROUPS: NavGroup[] = [
  {
    href: "/dashboard",
    label: "Dashboard",
    icon: LayoutDashboard,
  },
  {
    href: "/supply",
    label: "Receiving",
    icon: ArrowDownToLine,
    tabs: [
      { href: "/supply", label: "Supply Orders" },
      { href: "/inbound", label: "Inbound Processing" },
    ],
  },
  {
    href: "/outbound",
    label: "Outbound",
    icon: ArrowUpFromLine,
    tabs: [
      { href: "/outbound", label: "Device Outbound" },
      { href: "/accessories", label: "Accessory Outbound" },
    ],
  },
  {
    href: "/bins",
    label: "Inventory",
    icon: Boxes,
    tabs: [
      { href: "/bins", label: "Inventory Setup" },
      { href: "/labels", label: "Label Printing" },
    ],
  },
  {
    href: "/returns",
    label: "Operations",
    icon: Repeat,
    tabs: [
      { href: "/returns", label: "Customer Returns" },
      { href: "/transfer", label: "Stock Transfers" },
    ],
  },
  {
    href: "/nrd",
    label: "NRD",
    icon: Timer,
  },
  {
    href: "/admin",
    label: "Admin",
    icon: ShieldCheck,
    adminOnly: true,
  },
];

function isRouteActive(pathname: string, href: string) {
  return pathname === href || pathname.startsWith(`${href}/`);
}

function isGroupActive(pathname: string, group: NavGroup) {
  const routes = group.tabs?.map((tab) => tab.href) ?? [group.href];
  return routes.some((href) => isRouteActive(pathname, href));
}

function getEmailInitials(email: string | null) {
  if (!email) return "?";

  const name = email.split("@")[0];
  const parts = name.split(/[._\s-]+/).filter(Boolean);

  if (parts.length > 1) {
    return parts
      .slice(0, 2)
      .map((part) => part[0])
      .join("")
      .toUpperCase();
  }

  return name.slice(0, 2).toUpperCase();
}

export default function AppShell({ children }: { children: ReactNode }) {
  const pathname = usePathname() || "";
  const [email, setEmail] = useState<string | null>(null);
  const [role, setRole] = useState<string | null>(null);
  const [activeNrd, setActiveNrd] = useState<any>(null);

  const supabase = createSupabaseBrowserClient();
  const router = useRouter();

  async function handleLogout() {
    await supabase.auth.signOut();
    router.push("/login");
  }

  useEffect(() => {
    async function loadUserAndNrd() {
      const { data } = await supabase.auth.getUser();
      const user = data?.user;

      setEmail(user?.email || null);
      setRole(await getUserRole());

      if (user?.email) {
        const res = await fetch(
          `/api/nrd/current?user_email=${encodeURIComponent(
            user.email
          )}&t=${Date.now()}`,
          { cache: "no-store" }
        );

        const json = await res.json();

        if (json.ok) {
          setActiveNrd(json.active || null);
        }
      } else {
        setActiveNrd(null);
      }
    }

    loadUserAndNrd();

    const interval = setInterval(loadUserAndNrd, 5000);

    return () => clearInterval(interval);
  }, []);

  const visibleNavGroups =
    role === "viewer"
      ? NAV_GROUPS.filter((group) => group.href === "/dashboard")
      : NAV_GROUPS.filter((group) => !group.adminOnly || role === "admin");

  const activeGroup = visibleNavGroups.find((group) =>
    isGroupActive(pathname, group)
  );

  return (
    <div className="min-h-screen bg-sp-bg text-sp-body">
      <div className="sp-banner-test">
        TEST ENVIRONMENT — DO NOT PROCESS REAL INVENTORY
      </div>

      {activeNrd && (
        <div className="sp-banner-nrd">
          <div className="mx-auto flex max-w-[1360px] items-center justify-between gap-4 px-6">
            <div className="flex min-w-0 items-center justify-center gap-2">
              <Timer size={15} aria-hidden="true" />
              <span className="truncate">
                NRD task running: <b>{activeNrd.task}</b>
                <span className="ml-2 font-normal">
                  Started at{" "}
                  {new Date(activeNrd.started_at).toLocaleTimeString("en-GB")}
                </span>
              </span>
            </div>

            <Link href="/nrd" className="shrink-0 text-xs font-semibold underline">
              Open NRD
            </Link>
          </div>
        </div>
      )}

      <header className="sticky top-0 z-40">
        <div className="flex h-[60px] items-center border-b border-sp-border bg-sp-surface px-10">
          <div className="flex shrink-0 items-baseline gap-3">
            <Link href="/dashboard" className="text-base font-bold text-sp-text">
              StockPro
            </Link>
            <span className="hidden text-[12.5px] text-sp-muted lg:inline">
              Warehouse operations
            </span>
          </div>

          <nav
            aria-label="Primary navigation"
            className="mx-8 flex min-w-0 flex-1 items-center gap-1 overflow-x-auto"
          >
            {visibleNavGroups.map((group) => {
              const Icon = group.icon;
              const active = isGroupActive(pathname, group);

              return (
                <Link
                  key={group.label}
                  href={group.href}
                  className={`sp-nav-item flex shrink-0 items-center gap-2 ${
                    active ? "sp-nav-item-active" : ""
                  }`}
                >
                  <Icon
                    size={15}
                    aria-hidden="true"
                    className={active ? "text-sp-primary" : "text-sp-secondary"}
                  />
                  <span>{group.label}</span>
                </Link>
              );
            })}
          </nav>

          <div className="flex shrink-0 items-center gap-3">
            {email && (
              <span className="hidden max-w-48 truncate text-[12.5px] text-sp-secondary xl:block">
                {email}
              </span>
            )}
            <div className="sp-avatar" aria-label={email || "Signed-in user"}>
              {getEmailInitials(email)}
            </div>
            <button
              type="button"
              onClick={handleLogout}
              className="sp-btn sp-btn-ghost"
            >
              <LogOut size={15} aria-hidden="true" className="text-sp-secondary" />
              <span>Sign out</span>
            </button>
          </div>
        </div>

        {activeGroup?.tabs && (
          <nav
            aria-label={`${activeGroup.label} navigation`}
            className="flex gap-6 border-b border-sp-border bg-sp-surface px-10 py-2"
          >
            {activeGroup.tabs.map((tab) => (
              <Link
                key={tab.href}
                href={tab.href}
                className={`sp-tab ${
                  isRouteActive(pathname, tab.href) ? "sp-tab-active" : ""
                }`}
              >
                {tab.label}
              </Link>
            ))}
          </nav>
        )}
      </header>

      <main className="mx-auto w-full max-w-[1360px] px-6 py-6">{children}</main>
    </div>
  );
}
