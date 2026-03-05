import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

export async function POST(req: Request) {

  try {

    const { email, role } = await req.json();

    if (!email) {
      return NextResponse.json({ error: "Email required" }, { status: 400 });
    }

    // Invite user by email
    const { data, error } = await supabase.auth.admin.inviteUserByEmail(email);

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    const userId = data.user?.id;

    if (!userId) {
      return NextResponse.json({ error: "User creation failed" }, { status: 500 });
    }

    // Insert role
    const { error: roleError } = await supabase
      .from("user_roles")
      .insert({
        user_id: userId,
        role: role || "viewer"
      });

    if (roleError) {
      return NextResponse.json({ error: roleError.message }, { status: 500 });
    }

    return NextResponse.json({ ok: true });

  } catch (err) {
    return NextResponse.json({ error: "Server error" }, { status: 500 });
  }
}