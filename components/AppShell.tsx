"use client";

import { createSupabaseBrowserClient } from "@/lib/supabase/client";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { ReactNode, useState, useEffect, useMemo } from "react";
import {
  LayoutDashboard,
  ArrowDownToLine,
  ArrowUpFromLine,
  Tag,
  Menu,
  Package,
  Boxes,
  Repeat,
  RotateCcw,
  LogOut,
  Timer,
  Truck,
  ShieldCheck,
  ChevronDown,
  ClipboardList,
} from "lucide-react";
import { PermissionKey } from "@/lib/access-control";
import { useAccess } from "@/components/AccessProvider";
import { apiFetch } from "@/lib/apiFetch";
import { signOutCurrentDevice } from "@/lib/session-control";

type NavItem = {
  href: string;
  label: string;
  icon: typeof LayoutDashboard;
  permission: PermissionKey;
};

type NavGroup = {
  id: string;
  label: string;
  icon: typeof LayoutDashboard;
  items: NavItem[];
};

const DASHBOARD_ITEM: NavItem = {
  href: "/dashboard",
  label: "Dashboard",
  icon: LayoutDashboard,
  permission: "can_dashboard",
};

const NAV_GROUPS: NavGroup[] = [
  {
    id: "receiving",
    label: "Receiving",
    icon: ArrowDownToLine,
    items: [
      { href: "/supply", label: "Supply", icon: Truck, permission: "can_supply" },
      {
        href: "/inbound",
        label: "Inbound Import",
        icon: ArrowDownToLine,
        permission: "can_inbound",
      },
    ],
  },
  {
    id: "outbound",
    label: "Outbound",
    icon: ArrowUpFromLine,
    items: [
      {
        href: "/outbound",
        label: "Devices",
        icon: ArrowUpFromLine,
        permission: "can_outbound",
      },
      {
        href: "/accessories",
        label: "Accessories",
        icon: Boxes,
        permission: "can_accessories",
      },
    ],
  },
  {
    id: "inventory",
    label: "Inventory",
    icon: Package,
    items: [
      {
        href: "/bins",
        label: "Stock Settings",
        icon: Package,
        permission: "can_bins",
      },
      { href: "/labels", label: "Labels", icon: Tag, permission: "can_labels" },
    ],
  },
  {
    id: "operations",
    label: "Operations",
    icon: Repeat,
    items: [
      {
        href: "/returns",
        label: "Returns",
        icon: RotateCcw,
        permission: "can_returns",
      },
      {
        href: "/transfer",
        label: "Transfers",
        icon: Repeat,
        permission: "can_transfer",
      },
    ],
  },
  {
    id: "work",
    label: "Work",
    icon: ClipboardList,
    items: [
      { href: "/nrd", label: "NRD Tracker", icon: Timer, permission: "can_nrd" },
    ],
  },
  {
    id: "system",
    label: "System",
    icon: ShieldCheck,
    items: [
      { href: "/admin", label: "Admin", icon: ShieldCheck, permission: "can_admin" },
    ],
  },
];

function isActivePath(pathname: string, href: string) {
  return pathname === href || pathname.startsWith(`${href}/`);
}

export default function AppShell({ children }: { children: ReactNode }) {
  const pathname = usePathname() || "";
  const appEnvironment = process.env.NEXT_PUBLIC_APP_ENV || "production";
  const isNonProduction = appEnvironment !== "production";
  const [collapsed, setCollapsed] = useState(false);
  const activeGroupId =
    NAV_GROUPS.find((group) =>
      group.items.some((item) => isActivePath(pathname, item.href))
    )?.id ?? null;
  const [openGroupId, setOpenGroupId] = useState<string | null>(activeGroupId);
  const [email, setEmail] = useState<string | null>(null);
  const [activeNrd, setActiveNrd] = useState<any>(null);
  const { hasPermission } = useAccess();

  const supabase = useMemo(() => createSupabaseBrowserClient(), []);
  const router = useRouter();

  useEffect(() => {
    setOpenGroupId(activeGroupId);
  }, [activeGroupId]);

  async function handleLogout() {
    await signOutCurrentDevice(supabase, window.sessionStorage);
    router.replace("/login");
    router.refresh();
  }

  useEffect(() => {
    async function loadUserAndNrd() {
      const { data } = await supabase.auth.getUser();
      const user = data?.user;

      setEmail(user?.email || null);

      if (user?.email && hasPermission("can_nrd")) {
        const res = await apiFetch(
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
    <div className="min-h-screen flex bg-slate-950 text-slate-100">
      <aside
        className={[
          "h-screen sticky top-0 shrink-0 relative",
          "bg-slate-950 border-r border-slate-800/80",
          "transition-all duration-300",
          collapsed ? "w-[72px]" : "w-[260px]",
        ].join(" ")}
      >
        <div className="h-14 flex items-center justify-between px-3 border-b border-slate-800/80">
          <div className="flex items-center gap-2">
            <div className="h-9 w-9 rounded-xl bg-indigo-600 grid place-items-center">
              <Package size={18} className="text-white" />
            </div>
            {!collapsed && (
              <div>
                <div className="font-semibold">StockPro</div>
                <div className="text-[11px] text-slate-400">
                  Inventory console
                </div>
              </div>
            )}
          </div>

          <button onClick={() => setCollapsed(!collapsed)}>
            <Menu size={18} />
          </button>
        </div>

        <nav className="h-[calc(100vh-3.5rem)] overflow-y-auto px-2 py-4 pb-28 text-sm">
          {hasPermission(DASHBOARD_ITEM.permission) && (
            <Link
              href={DASHBOARD_ITEM.href}
              title={collapsed ? DASHBOARD_ITEM.label : undefined}
              className={`
                flex items-center gap-3 rounded-xl px-3 py-2
                transition-all duration-200
                ${collapsed ? "justify-center" : ""}
                hover:bg-slate-800/80
                ${
                  isActivePath(pathname, DASHBOARD_ITEM.href)
                    ? "bg-slate-800/80 ring-1 ring-inset ring-slate-700/70"
                    : ""
                }
              `}
            >
              <LayoutDashboard size={18} className="shrink-0" />
              {!collapsed && <span>{DASHBOARD_ITEM.label}</span>}
            </Link>
          )}

          <div className="mt-3 space-y-1">
            {NAV_GROUPS.map((group) => {
              const permittedItems = group.items.filter((item) =>
                hasPermission(item.permission)
              );
              if (permittedItems.length === 0) return null;

              const GroupIcon = group.icon;
              const isOpen = openGroupId === group.id;
              const isGroupActive = activeGroupId === group.id;

              if (collapsed) {
                return (
                  <button
                    key={group.id}
                    type="button"
                    title={group.label}
                    aria-label={`Open ${group.label} menu`}
                    onClick={() => {
                      setOpenGroupId(group.id);
                      setCollapsed(false);
                    }}
                    className={`
                      flex w-full items-center justify-center rounded-xl px-3 py-2
                      transition-all duration-200 hover:bg-slate-800
                      ${
                        isGroupActive
                          ? "bg-slate-800/80 text-indigo-300 ring-1 ring-inset ring-slate-700/70"
                          : "text-slate-300"
                      }
                    `}
                  >
                    <GroupIcon size={18} />
                  </button>
                );
              }

              return (
                <div key={group.id}>
                  <button
                    type="button"
                    aria-expanded={isOpen}
                    aria-controls={`nav-group-${group.id}`}
                    onClick={() => setOpenGroupId(isOpen ? null : group.id)}
                    className={`
                      flex w-full items-center gap-3 rounded-xl px-3 py-2
                      text-left font-medium transition-all duration-200 hover:bg-slate-800/80
                      ${isGroupActive ? "text-indigo-300" : "text-slate-300"}
                    `}
                  >
                    <GroupIcon size={18} className="shrink-0" />
                    <span className="flex-1">{group.label}</span>
                    <ChevronDown
                      size={15}
                      className={`transition-transform duration-200 ${
                        isOpen ? "rotate-180" : ""
                      }`}
                    />
                  </button>

                  {isOpen && (
                    <div
                      id={`nav-group-${group.id}`}
                      className="ml-5 mt-1 space-y-1 border-l border-slate-800 pl-2"
                    >
                      {permittedItems.map((item) => {
                        const Icon = item.icon;
                        const isActive = isActivePath(pathname, item.href);

                        return (
                          <Link
                            key={item.href}
                            href={item.href}
                            aria-current={isActive ? "page" : undefined}
                            className={`
                              flex items-center gap-3 rounded-xl px-3 py-2
                              transition-all duration-200 hover:bg-slate-800/80
                              ${
                                isActive
                                  ? "bg-indigo-500/10 text-indigo-100 ring-1 ring-inset ring-indigo-400/20"
                                  : "text-slate-400"
                              }
                            `}
                          >
                            <Icon size={16} className="shrink-0" />
                            <span>{item.label}</span>
                          </Link>
                        );
                      })}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </nav>

        <div className="absolute bottom-4 left-0 w-full px-2 border-t border-slate-800 pt-3">
          {!collapsed && email && (
            <div className="px-3 py-2 text-xs text-slate-400 truncate">
              {email}
            </div>
          )}

          <button
            onClick={handleLogout}
            className={`
              flex items-center gap-3 px-3 py-2 rounded-xl w-full
              transition-all duration-200
              ${collapsed ? "justify-center" : ""}
              hover:bg-slate-800/80 hover:text-red-300
            `}
          >
            <LogOut size={18} />
            {!collapsed && <span>Logout</span>}
          </button>
        </div>
      </aside>

      <section className="flex-1 p-8">
        {isNonProduction && (
          <div className="mb-4 rounded-xl border border-cyan-400/50 bg-cyan-400/10 px-4 py-3 text-center text-sm font-semibold uppercase tracking-[0.18em] text-cyan-200">
            Environnement de test — aucune operation ne doit concerner du stock reel
          </div>
        )}

        {activeNrd && (
          <div className="mb-4 rounded-xl border border-amber-500/40 bg-amber-500/10 text-amber-200 px-4 py-3 text-sm flex items-center justify-between">
            <div>
              ⏱ NRD task running: <b>{activeNrd.task}</b>
              <span className="text-amber-300/70 ml-2">
                Started at{" "}
                {new Date(activeNrd.started_at).toLocaleTimeString()}
              </span>
            </div>

            <Link href="/nrd" className="text-xs underline font-semibold">
              Open NRD
            </Link>
          </div>
        )}

        <div
          className={`mx-auto w-full transition-all duration-300 ${
            collapsed ? "max-w-[1400px]" : "max-w-screen-xl"
          }`}
        >
          {children}
        </div>
      </section>
    </div>
  );
}
