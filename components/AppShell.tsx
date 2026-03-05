"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { ReactNode, useState } from "react";
import {
  LayoutDashboard,
  ArrowDownToLine,
  ArrowUpFromLine,
  Tag,
  Menu,
  Package,
  Repeat,
} from "lucide-react";

const NAV = [
  { href: "/dashboard", label: "Dashboard", icon: LayoutDashboard },
  { href: "/inbound", label: "Inbound Import", icon: ArrowDownToLine },
  { href: "/labels", label: "Labels", icon: Tag },
  { href: "/outbound", label: "Outbound", icon: ArrowUpFromLine },
  { href: "/transfer", label: "Transfer", icon: Repeat }, // ✅ NEW
  { href: "/bins", label: "Bins", icon: Package },
];

export default function AppShell({ children }: { children: ReactNode }) {
  const pathname = usePathname() || "";
  const [collapsed, setCollapsed] = useState(false);

  return (
    <div className="min-h-screen flex bg-slate-950 text-slate-100">
      <aside
  className={[
    "h-screen sticky top-0 shrink-0",
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

        <nav className="px-2 py-4 space-y-1 text-sm">
          {NAV.map((item) => {
            const Icon = item.icon;
            return (
              <Link
  key={item.href}
  href={item.href}
  className={`
  flex items-center gap-3 px-3 py-2 rounded-xl
  transition-all duration-200
  ${collapsed ? "justify-center" : ""}
  hover:bg-slate-800 hover:shadow-[0_0_12px_rgba(99,102,241,0.15)]
  ${pathname.startsWith(item.href)
    ? "bg-slate-800 shadow-[0_0_12px_rgba(99,102,241,0.25)]"
    : ""}
`}
>
                <Icon size={18} className="shrink-0" />
                {!collapsed && <span>{item.label}</span>}
              </Link>
            );
          })}
        </nav>
      </aside>

      <section className="flex-1 p-8">
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