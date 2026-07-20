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
  return supabase
    .from("profiles")
    .update({ last_seen_at: now.toISOString() })
    .eq("user_id", userId)
    .eq("current_session_id", sessionId);
}

export async function signOutCurrentDevice(
  supabase: SupabaseClient,
  storage: SessionStorage,
  now = new Date()
) {
  const localSessionId = storage.getItem(STOCKPRO_SESSION_KEY);
  let profileError: unknown = null;
  try {
    const {
      data: { user },
    } = await supabase.auth.getUser();

    if (user && localSessionId) {
      const { error } = await supabase
        .from("profiles")
        .update({
          current_session_id: null,
          last_seen_at: now.toISOString(),
        })
        .eq("user_id", user.id)
        .eq("current_session_id", localSessionId);

      profileError = error;
    }
  } catch (error) {
    profileError = error;
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
