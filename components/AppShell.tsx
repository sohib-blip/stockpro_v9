"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { ReactNode, useEffect, useMemo, useState } from "react";
import { createSupabaseBrowserClient } from "@/lib/supabase/client";
import {
  LayoutDashboard,
  ArrowDownToLine,
  ArrowUpFromLine,
  Tag,
  Shield,
  Menu,
  Package,
} from "lucide-react";

type Permissions = {
  can_dashboard: boolean;
  can_inbound: boolean;
  can_outbound: boolean;
  can_labels: boolean;
  can_devices: boolean;
  can_admin: boolean;
};

type NavItem = {
  href: string;
  label: string;
  icon: React.ElementType;
  permission?: keyof Permissions;
};

const MAIN_NAV: NavItem[] = [
  { href: "/dashboard", label: "Dashboard", icon: LayoutDashboard, permission: "can_dashboard" },
  { href: "/inbound", label: "Inbound Import", icon: ArrowDownToLine, permission: "can_inbound" },
  { href: "/labels", label: "Labels", icon: Tag, permission: "can_labels" },
  { href: "/outbound", label: "Outbound", icon: ArrowUpFromLine, permission: "can_outbound" },
];

const CONTROL_TOWER_NAV: NavItem[] = [
  { href: "/admin", label: "Admin Overview", icon: Shield, permission: "can_admin" },
  { href: "/admin/devices", label: "Devices (Bins)", icon: Package, permission: "can_devices" },
];

export default function AppShell({ children }: { children: ReactNode }) {
  const supabase = useMemo(() => createSupabaseBrowserClient(), []);
  const pathname = usePathname() || "";

  const [collapsed, setCollapsed] = useState(false);
  const [email, setEmail] = useState("");
  const [perms, setPerms] = useState<Permissions>({
    can_dashboard: false,
    can_inbound: false,
    can_outbound: false,
    can_labels: false,
    can_devices: false,
    can_admin: false,
  });

  useEffect(() => {
    supabase.auth.getUser().then(async ({ data }) => {
      setEmail(data.user?.email ?? "");

      if (data.user?.id) {
        const { data: p } = await supabase
          .from("user_permissions")
          .select(
            "can_dashboard,can_inbound,can_outbound,can_labels,can_devices,can_admin"
          )
          .eq("user_id", data.user.id)
          .maybeSingle();

        if (p) {
          setPerms({
            can_dashboard: !!p.can_dashboard,
            can_inbound: !!p.can_inbound,
            can_outbound: !!p.can_outbound,
            can_labels: !!p.can_labels,
            can_devices: !!p.can_devices,
            can_admin: !!p.can_admin,
          });
        }
      }
    });
  }, [supabase]);

  // 🔒 PAGE BLOCKER (ULTRA SIMPLE)
  if (
    (pathname.startsWith("/dashboard") && !perms.can_dashboard) ||
    (pathname.startsWith("/inbound") && !perms.can_inbound) ||
    (pathname.startsWith("/outbound") && !perms.can_outbound) ||
    (pathname.startsWith("/labels") && !perms.can_labels) ||
    (pathname.startsWith("/admin/devices") && !perms.can_devices) ||
    (pathname === "/admin" && !perms.can_admin)
  ) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-slate-950 text-slate-100">
        <div className="text-center space-y-3">
          <h2 className="text-xl font-semibold text-rose-400">
            Access Denied
          </h2>
          <p className="text-slate-400 text-sm">
            You do not have permission to access this page.
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen flex bg-slate-950 text-slate-100">
      {/* SIDEBAR */}
      <aside
        className={[
          "h-screen sticky top-0 shrink-0",
          "bg-slate-950 border-r border-slate-800/80",
          collapsed ? "w-[72px]" : "w-[268px]",
        ].join(" ")}
      >
        {/* HEADER */}
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

        {/* MAIN NAV */}
        <nav className="px-2 py-4 space-y-1 text-sm">
          {MAIN_NAV.filter((item) => !item.permission || perms[item.permission]).map(
            (item) => {
              const Icon = item.icon;
              return (
                <Link
                  key={item.href}
                  href={item.href}
                  className="flex items-center gap-3 px-3 py-2 rounded-xl hover:bg-slate-800"
                >
                  <Icon size={18} />
                  {!collapsed && <span>{item.label}</span>}
                </Link>
              );
            }
          )}
        </nav>

        {/* CONTROL TOWER */}
        {(perms.can_admin || perms.can_devices) && (
          <>
            <div className="px-3 mt-4 mb-2 text-[11px] uppercase tracking-wider text-slate-500">
              {!collapsed && "Control Tower"}
            </div>

            <nav className="px-2 space-y-1 text-sm">
              {CONTROL_TOWER_NAV.filter(
                (item) => !item.permission || perms[item.permission]
              ).map((item) => {
                const Icon = item.icon;
                return (
                  <Link
                    key={item.href}
                    href={item.href}
                    className="flex items-center gap-3 px-3 py-2 rounded-xl hover:bg-slate-800"
                  >
                    <Icon size={18} />
                    {!collapsed && <span>{item.label}</span>}
                  </Link>
                );
              })}
            </nav>
          </>
        )}

        {/* FOOTER */}
        <div className="absolute bottom-0 left-0 right-0 p-3 border-t border-slate-800/80 text-xs text-slate-500">
          {!collapsed && <div>Signed in as {email}</div>}
        </div>
      </aside>

      {/* CONTENT */}
      <section className="flex-1 p-6">{children}</section>
    </div>
  );
}