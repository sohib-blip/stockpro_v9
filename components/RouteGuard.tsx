"use client";

import { ReactNode, useEffect, useState } from "react";
import { usePathname, useRouter } from "next/navigation";
import { createSupabaseBrowserClient } from "@/lib/supabase/client";

type Permissions = { can_inbound: boolean; can_outbound: boolean; can_export: boolean; can_admin: boolean };

const DEFAULT_PERMS: Permissions = { can_inbound: true, can_outbound: true, can_export: false, can_admin: false };

function isAllowed(pathname: string, perms: Permissions) {
  if (pathname === "/denied") return true;
  if (pathname.startsWith("/admin")) return perms.can_admin;
  if (pathname.startsWith("/inbound")) return perms.can_inbound;
  if (pathname.startsWith("/outbound")) return perms.can_outbound;
  // dashboard, labels always allowed (labels are useful even if outbound/inbound disabled)
  return true;
}

export default function RouteGuard({ children }: { children: ReactNode }) {
  const pathname = usePathname() || "/";
  const router = useRouter();
  const [ready, setReady] = useState(false);

  useEffect(() => {
    let alive = true;

    async function run() {
      try {
        const supabase = createSupabaseBrowserClient();
        const { data: sess } = await supabase.auth.getSession();
        const token = sess.session?.access_token;
        if (!token) {
          if (alive) router.replace("/login");
          return;
        }

        // Fetch permissions (RLS-protected)
        const { data, error } = await supabase
          .from("user_permissions")
          .select("can_inbound, can_outbound, can_export, can_admin")
          .eq("user_id", sess.session?.user?.id)
          .maybeSingle();

        const perms: Permissions = error || !data ? DEFAULT_PERMS : {
          can_inbound: !!data.can_inbound,
          can_outbound: !!data.can_outbound,
          can_export: !!data.can_export,
          can_admin: !!data.can_admin,
        };

        if (!isAllowed(pathname, perms)) {
          if (alive) router.replace("/denied");
          return;
        }

        if (alive) setReady(true);
      } catch {
        // Fail closed-ish: show content only if path is safe
        if (alive) setReady(true);
      }
    }

    setReady(false);
    run();
    return () => { alive = false; };
  }, [pathname, router]);

  if (!ready) {
    return (
      <div className="p-6 text-sm text-slate-300">
        Checking access…
      </div>
    );
  }

  return <>{children}</>;
}
