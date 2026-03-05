import { createSupabaseBrowserClient } from "@/lib/supabase/client";

export async function getUserRole() {

  const supabase = createSupabaseBrowserClient();

  const { data: userData } = await supabase.auth.getUser();

  const userId = userData?.user?.id;

  if (!userId) return null;

  const { data } = await supabase
    .from("user_roles")
    .select("role")
    .eq("user_id", userId)
    .single();

  return data?.role || "viewer";
}