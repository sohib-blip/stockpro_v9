import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

export async function POST(req: Request) {

  const { email, role } = await req.json();

  const { data, error } = await supabase.auth.admin.inviteUserByEmail(email);

  if (error) {
    console.log(error);
    return NextResponse.json({ error: error.message });
  }

  const userId = data.user?.id;

  const { error: roleError } = await supabase
    .from("user_roles")
    .insert({
      user_id: userId,
      role
    });

  if (roleError) {
    console.log(roleError);
  }

  return NextResponse.json({ ok: true });
}