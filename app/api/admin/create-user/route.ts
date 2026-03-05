import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

export async function POST(req: Request) {

  try {

    const { email, role } = await req.json();

    const supabase = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.SUPABASE_SERVICE_ROLE_KEY!
    );

    const { data, error } = await supabase.auth.admin.createUser({
      email,
      password: "TempPassword123!",
      email_confirm: true
    });

    console.log("CREATE USER RESULT:", data);
    console.log("CREATE USER ERROR:", error);

    if (error) {
      return NextResponse.json({ error: error.message });
    }

    const userId = data.user.id;

    const { error: roleError } = await supabase
      .from("user_roles")
      .insert({
        user_id: userId,
        role
      });

    console.log("ROLE INSERT ERROR:", roleError);

    if (roleError) {
      return NextResponse.json({ error: roleError.message });
    }

    return NextResponse.json({ ok: true });

  } catch (err) {

    console.log("SERVER ERROR:", err);

    return NextResponse.json({
      error: "Server crash",
      details: String(err)
    });

  }

}