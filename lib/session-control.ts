import type { SupabaseClient } from "@supabase/supabase-js";

export const STOCKPRO_SESSION_KEY = "stockpro_session_id";
export const STOCKPRO_SESSION_NOTICE_KEY = "stockpro_session_notice";

type SessionStorage = Pick<Storage, "getItem" | "removeItem">;

export async function touchOwnedSession(
  supabase: SupabaseClient,
  userId: string,
  sessionId: string,
  now = new Date()
) {
  void userId;
  void sessionId;
  void now;

  const {
    data: { session },
  } = await supabase.auth.getSession();
  if (!session?.access_token) {
    return { error: new Error("Missing authentication session") };
  }

  const response = await fetch("/api/auth/session", {
    method: "PATCH",
    headers: { Authorization: `Bearer ${session.access_token}` },
  });
  return {
    error: response.ok
      ? null
      : new Error(`Unable to refresh application session (${response.status})`),
  };
}

export async function signOutCurrentDevice(
  supabase: SupabaseClient,
  storage: SessionStorage,
  now = new Date()
) {
  const localSessionId = storage.getItem(STOCKPRO_SESSION_KEY);
  let profileError: unknown = null;
  void now;
  if (localSessionId) {
    try {
      const {
        data: { session },
      } = await supabase.auth.getSession();
      if (session?.access_token) {
        const response = await fetch("/api/auth/session", {
          method: "DELETE",
          headers: { Authorization: `Bearer ${session.access_token}` },
        });
        if (!response.ok) {
          profileError = new Error(
            `Unable to end application session (${response.status})`
          );
        }
      }
    } catch (error) {
      profileError = error;
    }
  }

  storage.removeItem(STOCKPRO_SESSION_KEY);
  let signOutError: unknown = null;
  try {
    const { error } = await supabase.auth.signOut({ scope: "local" });
    signOutError = error;
  } catch (error) {
    signOutError = error;
  }

  return { profileError, signOutError };
}
