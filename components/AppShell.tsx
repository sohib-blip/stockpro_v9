"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { ReactNode, useEffect, useMemo, useState } from "react";
import { createSupabaseBrowserClient } from "@/lib/supabase/client";

type NavItem = { href: string; label: string; icon: string };

const NAV: NavItem[] = [
  { href: "/dashboard", label: "Dashboard", icon: "📊" },
  { href: "/inbound", label: "Inbound Import", icon: "📦" },
  { href:"/movements", label:"Mouvements", icon:"⬆️⬇️" },
  { href: "/labels", label: "Labels", icon: "🏷️" },
  { href: "/outbound", label: "Outbound", icon: "📤" },
  { href: "/alerts", label: "Stock Alerts", icon: "🚨" },
  { href: "/admin", label: "Admin", icon: "🛡️" },
];

function pageTitle(pathname: string) {
  if (pathname === "/" || pathname.startsWith("/dashboard")) return "Dashboard";
  if (pathname.startsWith("/inbound")) return "Inbound Import";
  if (pathname.startsWith("/labels")) return "QR Labels";
  if (pathname.startsWith("/outbound")) return "Outbound (Scan)";
  if (pathname.startsWith("/alerts")) return "Stock Alerts";
  if (pathname.startsWith("/admin")) return "Admin";
  return "StockPro";
}

export default function AppShell({ children }: { children: ReactNode }) {
  const supabase = useMemo(() => createSupabaseBrowserClient(), []);
  const pathname = usePathname();
  const router = useRouter();

  const [collapsed, setCollapsed] = useState(false);
  const [email, setEmail] = useState<string>("");

  const [perms, setPerms] = useState({
    can_inbound: true,
    can_outbound: true,
    can_export: false,
    can_admin: false,
  });

  // 🔴 compteur low stock
  const [lowCount, setLowCount] = useState<number>(0);

  useEffect(() => {
    supabase.auth.getUser().then(async ({ data }) => {
      setEmail(data.user?.email ?? "");
      if (data.user?.id) {
        const { data: p } = await supabase
          .from("user_permissions")
          .select("can_inbound,can_outbound,can_export,can_admin")
          .eq("user_id", data.user.id)
          .maybeSingle();
        if (p) {
          setPerms({
            can_inbound: !!p.can_inbound,
            can_outbound: !!p.can_outbound,
            can_export: !!p.can_export,
            can_admin: !!p.can_admin,
          });
        }
      }
    });

    const { data: sub } = supabase.auth.onAuthStateChange((_e, session) => {
      setEmail(session?.user?.email ?? "");
      if (!session?.user) {
        setPerms({ can_inbound: true, can_outbound: true, can_export: false, can_admin: false });
      }
    });

    return () => sub.subscription.unsubscribe();
  }, [supabase]);

  // 🔴 load low stock counter
  useEffect(() => {
    async function loadLowStock() {
      try {
        const { data: session } = await supabase.auth.getSession();
        const token = session.session?.access_token;
        if (!token) return;

        const summaryRes = await fetch("/api/dashboard/summary", {
          headers: { Authorization: `Bearer ${token}` },
        });
        const summary = await summaryRes.json();

        const { data: thresholds } = await supabase
          .from("device_thresholds")
          .select("device,min_stock");

        const map = new Map(
          (thresholds || []).map((t: any) => [t.device, Number(t.min_stock || 0)])
        );

        const low = (summary.per_device || []).filter(
          (d: any) => d.in_stock <= (map.get(d.device) ?? 0)
        );

        setLowCount(low.length);
      } catch {
        setLowCount(0);
      }
    }

    loadLowStock();
  }, [supabase]);

  async function logout() {
    await supabase.auth.signOut();
    setEmail("");
    router.push("/login");
    router.refresh();
  }

  const title = pageTitle(pathname);

  return (
    <div className="min-h-screen flex bg-slate-950 text-slate-100">
      <aside
        className={[
          "h-screen sticky top-0 shrink-0",
          "bg-slate-950 border-r border-slate-800/80",
          "transition-all duration-200",
          collapsed ? "w-[72px]" : "w-[268px]",
        ].join(" ")}
      >
        <div className="h-14 flex items-center justify-between px-3 border-b border-slate-800/80">
          <div className="flex items-center gap-2">
            <div className="h-9 w-9 rounded-xl bg-slate-900 border border-slate-800 grid place-items-center">
              📦
            </div>
            {!collapsed && (
              <div className="leading-tight">
                <div className="font-semibold">StockPro</div>
                <div className="text-[11px] text-slate-400">Inventory console</div>
              </div>
            )}
          </div>

          <button
            onClick={() => setCollapsed((v) => !v)}
            className="h-9 w-9 rounded-xl bg-slate-900 border border-slate-800 hover:bg-slate-800 grid place-items-center"
          >
            ☰
          </button>
        </div>

        <nav className="px-2 py-3 space-y-1 text-sm">
          {NAV.filter((item) => {
            if (item.href === "/admin") return perms.can_admin;
            if (item.href === "/inbound") return perms.can_inbound;
            if (item.href === "/outbound") return perms.can_outbound;
            return true;
          }).map((item) => {
            const active =
              item.href === "/dashboard"
                ? pathname === "/" || pathname.startsWith("/dashboard")
                : pathname.startsWith(item.href);

            return (
              <Link
                key={item.href}
                href={item.href}
                className={[
                  "flex items-center justify-between gap-3 px-3 py-2 rounded-xl",
                  active
                    ? "bg-slate-800 text-slate-50 border border-slate-700"
                    : "text-slate-200 hover:bg-slate-900 hover:text-slate-50",
                ].join(" ")}
              >
                <div className="flex items-center gap-3">
                  <span className="text-lg">{item.icon}</span>
                  {!collapsed && <span className="font-medium">{item.label}</span>}
                </div>

                {/* 🔴 badge low stock */}
                {!collapsed && item.href === "/alerts" && lowCount > 0 && (
                  <span className="rounded-full bg-red-600 px-2 py-0.5 text-xs font-bold text-white">
                    {lowCount}
                  </span>
                )}
              </Link>
            );
          })}
        </nav>

        <div className="absolute bottom-0 left-0 right-0 p-2 border-t border-slate-800/80">
          <div className="rounded-2xl bg-slate-900 border border-slate-800 p-2">
            {!collapsed ? (
              <>
                <div className="text-[11px] text-slate-400">Signed in</div>
                <div className="text-sm font-semibold truncate">{email || "—"}</div>
                <button
                  onClick={logout}
                  className="mt-2 w-full rounded-xl bg-rose-600 hover:bg-rose-700 px-3 py-2 text-sm font-semibold"
                >
                  Sign out
                </button>
              </>
            ) : (
              <button
                onClick={logout}
                className="w-full rounded-xl bg-rose-600 hover:bg-rose-700 px-3 py-2 text-sm font-semibold"
              >
                🚪
              </button>
            )}
          </div>
        </div>
      </aside>

      <section className="flex-1 min-w-0">
        <header className="h-14 border-b border-slate-800/80 flex items-center justify-between px-4">
          <h1 className="font-semibold truncate">{title}</h1>
          <div className="text-sm text-slate-400 truncate">{email}</div>
        </header>

        <main className="p-4 md:p-6">{children}</main>
      </section>
    </div>
  );
}
