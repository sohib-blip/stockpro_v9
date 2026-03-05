import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

export async function POST(req: Request) {

  const { email, role } = await req.json();

  // 1️⃣ create user
  const { data, error } = await supabase.auth.admin.createUser({
    email,
    password: "TempPassword123!",
    email_confirm: true
  });

  if (error) {
    console.log("CREATE USER ERROR:", error);
    return NextResponse.json({ error: error.message });
  }

  const userId = data.user.id;

  // 2️⃣ assign role
  const { error: roleError } = await supabase
    .from("user_roles")
    .insert({
      user_id: userId,
      role
    });

  if (roleError) {
    console.log("ROLE INSERT ERROR:", roleError);
  }

  // 3️⃣ send reset password email
  await supabase.auth.resetPasswordForEmail(email, {
    redirectTo: `${process.env.NEXT_PUBLIC_SITE_URL}/reset-password`
  });

  return NextResponse.json({ ok: true });

}