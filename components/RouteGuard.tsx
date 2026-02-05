"use client";

import { usePathname, useRouter } from "next/navigation";
import { ReactNode, useEffect, useMemo, useState } from "react";
import { createSupabaseBrowserClient } from "@/lib/supabase/client";

type Props = { children: ReactNode };

function safeStartsWith(a: any, b: any) {
  return String(a ?? "").startsWith(String(b ?? ""));
}

export default function RouteGuard({ children }: Props) {
  const supabase = useMemo(() => createSupabaseBrowserClient(), []);
  const pathnameRaw = usePathname();
  const pathname = String(pathnameRaw ?? "");
  const router = useRouter();

  const [ready, setReady] = useState(false);

  useEffect(() => {
    let mounted = true;

    async function check() {
      try {
        const { data } = await supabase.auth.getSession();
        const logged = !!data.session;

        // Public routes
        const isLogin = safeStartsWith(pathname, "/login");
        const isPublic =
          pathname === "/" || isLogin || safeStartsWith(pathname, "/auth") || safeStartsWith(pathname, "/api");

        if (isPublic) {
          if (mounted) setReady(true);
          return;
        }

        if (!logged) {
          router.push("/login");
          router.refresh();
          return;
        }

        if (mounted) setReady(true);
      } catch {
        // If guard fails, don’t crash the app
        if (mounted) setReady(true);
      }
    }

    check();
    return () => {
      mounted = false;
    };
  }, [pathname, router, supabase]);

  if (!ready) return null;
  return <>{children}</>;
}