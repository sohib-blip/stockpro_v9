import type { SupabaseClient } from "@supabase/supabase-js";

// Administrators designated as IT contacts for the security update alert.
// Server-only: the table is reachable with the service role exclusively.
const TABLE = "security_alert_recipients";

export type SecurityAlertAudience = {
  /** The administrator asking may see the alert. */
  visible: boolean;
  /** Nobody is designated yet, so every administrator sees the alert. */
  itContactMissing: boolean;
};

/**
 * Only designated IT contacts who still hold the admin role count. While there
 * is none, every administrator sees the alert so it never goes unnoticed.
 * The caller must already have checked that `userId` is an administrator.
 */
export async function securityAlertAudience(
  supabase: SupabaseClient,
  userId: string
): Promise<SecurityAlertAudience> {
  const recipientIds = await securityAlertRecipientIds(supabase);
  if (recipientIds.size === 0) return { visible: true, itContactMissing: true };
  return { visible: recipientIds.has(userId), itContactMissing: false };
}

export async function securityAlertRecipientIds(supabase: SupabaseClient) {
  const { data: recipients, error } = await supabase
    .from(TABLE)
    .select("user_id");
  if (error) throw error;

  const ids = (recipients ?? []).map((row) => row.user_id as string);
  if (ids.length === 0) return new Set<string>();

  const { data: admins, error: rolesError } = await supabase
    .from("user_roles")
    .select("user_id")
    .eq("role", "admin")
    .in("user_id", ids);
  if (rolesError) throw rolesError;

  return new Set((admins ?? []).map((row) => row.user_id as string));
}

/** Adds or removes an IT contact. Only administrators can be IT contacts. */
export async function saveSecurityAlertRecipient(
  supabase: SupabaseClient,
  userId: string,
  role: string,
  enabled: boolean | undefined,
  addedByEmail: string | null
) {
  if (role === "admin" && enabled === undefined) return;

  if (role === "admin" && enabled) {
    const { error } = await supabase
      .from(TABLE)
      .upsert(
        { user_id: userId, added_by_email: addedByEmail },
        { onConflict: "user_id", ignoreDuplicates: true }
      );
    if (error) throw error;
    return;
  }

  const { error } = await supabase.from(TABLE).delete().eq("user_id", userId);
  if (error) throw error;
}
