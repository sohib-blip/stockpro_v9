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
  useRef,
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
  const initialLoadResolved = useRef(false);
  // User whose role and permissions are loaded, and the lookup in progress.
  const loadedUserId = useRef<string | null | undefined>(undefined);
  const pendingRefresh = useRef<Promise<void> | null>(null);

  const loadAccess = useCallback(async () => {
    // Supabase can emit SIGNED_IN/TOKEN_REFRESHED again when a background tab
    // becomes active. Only block the route during the first access lookup;
    // blocking every silent refresh unmounts the page and erases form state.
    if (!initialLoadResolved.current) setLoading(true);
    const {
      data: { user: currentUser },
    } = await supabase.auth.getUser();

    if (!currentUser) {
      loadedUserId.current = null;
      setUser(null);
      setAccess(EMPTY_ACCESS);
      initialLoadResolved.current = true;
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

    // User and access change together, so the app renders once per lookup.
    loadedUserId.current = currentUser.id;
    setUser(currentUser);
    setAccess({
      role: (roleRow?.role as AppRole | undefined) ?? null,
      permissions: permissionRow
        ? normalizePermissions(permissionRow)
        : { ...EMPTY_PERMISSIONS },
    });
    initialLoadResolved.current = true;
    setLoading(false);
  }, [supabase]);

  // Calls made while a lookup is running share it instead of starting another.
  const refreshAccess = useCallback(() => {
    if (!pendingRefresh.current) {
      pendingRefresh.current = loadAccess().finally(() => {
        pendingRefresh.current = null;
      });
    }
    return pendingRefresh.current;
  }, [loadAccess]);

  useEffect(() => {
    void refreshAccess();

    const { data } = supabase.auth.onAuthStateChange((event, session) => {
      // The first lookup above already covers the stored session, and a
      // renewed token changes neither the user nor their access.
      if (event === "INITIAL_SESSION" || event === "TOKEN_REFRESHED") return;
      // Supabase asks not to call it from inside this callback.
      setTimeout(() => {
        // Supabase repeats SIGNED_IN for the same user when a tab regains
        // focus; a lookup still running is shared by refreshAccess.
        if (event === "SIGNED_IN" && session?.user?.id === loadedUserId.current) return;
        void refreshAccess();
      }, 0);
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
