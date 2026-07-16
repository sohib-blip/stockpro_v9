"use client";

import { usePathname, useRouter } from "next/navigation";
import { ReactNode, useEffect } from "react";
import { permissionForPage } from "@/lib/access-control";
import { useAccess } from "@/components/AccessProvider";

type Props = { children: ReactNode };

export default function RouteGuard({ children }: Props) {
  const pathnameRaw = usePathname();
  const pathname = String(pathnameRaw ?? "");
  const router = useRouter();
  const { loading, user, hasPermission } = useAccess();

  useEffect(() => {
    if (loading) return;
    if (!user) {
      router.replace("/login");
      return;
    }

    const required = permissionForPage(pathname);
    if (required && !hasPermission(required)) {
      router.replace("/dashboard");
    }
  }, [hasPermission, loading, pathname, router, user]);

  if (loading || !user) return null;

  const required = permissionForPage(pathname);
  if (required && !hasPermission(required)) return null;

  return <>{children}</>;
}
