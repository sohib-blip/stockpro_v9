"use client";

import {
  AccessProfile,
  AppRole,
  EMPTY_PERMISSIONS,
  hasPermission as checkPermission,
  normalizePermissions,
  PermissionKey,
} from "@/lib/access-control";
import { createSupabaseBrowserClient } from "@/lib/supabase/client";
import { User } from "@supabase/supabase-js";
import {
  createContext,
  ReactNode,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
} from "react";

type AccessContextValue = {
  loading: boolean;
  user: User | null;
  access: AccessProfile;
  hasPermission: (permission: PermissionKey | readonly PermissionKey[]) => boolean;
  refreshAccess: () => Promise<void>;
};

const EMPTY_ACCESS: AccessProfile = {
  role: null,
  permissions: { ...EMPTY_PERMISSIONS },
};

const AccessContext = createContext<AccessContextValue | null>(null);

export default function AccessProvider({ children }: { children: ReactNode }) {
  const supabase = useMemo(() => createSupabaseBrowserClient(), []);
  const [loading, setLoading] = useState(true);
  const [user, setUser] = useState<User | null>(null);
  const [access, setAccess] = useState<AccessProfile>(EMPTY_ACCESS);

  const refreshAccess = useCallback(async () => {
    setLoading(true);
    const {
      data: { user: currentUser },
    } = await supabase.auth.getUser();

    setUser(currentUser ?? null);
    if (!currentUser) {
      setAccess(EMPTY_ACCESS);
      setLoading(false);
      return;
    }

    const [{ data: roleRow }, { data: permissionRow }] = await Promise.all([
      supabase
        .from("user_roles")
        .select("role")
        .eq("user_id", currentUser.id)
        .maybeSingle(),
      supabase
        .from("user_permissions")
        .select("*")
        .eq("user_id", currentUser.id)
        .maybeSingle(),
    ]);

    setAccess({
      role: (roleRow?.role as AppRole | undefined) ?? null,
      permissions: permissionRow
        ? normalizePermissions(permissionRow)
        : { ...EMPTY_PERMISSIONS },
    });
    setLoading(false);
  }, [supabase]);

  useEffect(() => {
    refreshAccess();

    const { data } = supabase.auth.onAuthStateChange(() => {
      refreshAccess();
    });

    return () => data.subscription.unsubscribe();
  }, [refreshAccess, supabase]);

  const value = useMemo<AccessContextValue>(
    () => ({
      loading,
      user,
      access,
      hasPermission: (permission) => checkPermission(access, permission),
      refreshAccess,
    }),
    [access, loading, refreshAccess, user]
  );

  return <AccessContext.Provider value={value}>{children}</AccessContext.Provider>;
}

export function useAccess() {
  const context = useContext(AccessContext);
  if (!context) throw new Error("useAccess must be used inside AccessProvider");
  return context;
}
