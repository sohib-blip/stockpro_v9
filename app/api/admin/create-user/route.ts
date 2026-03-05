import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

export async function POST(req: Request) {

  const { email, role } = await req.json();

  const { data, error } = await supabase.auth.admin.inviteUserByEmail(email);

  console.log("INVITE ERROR:", error);
  console.log("USER DATA:", data);

  if (error) {
    return NextResponse.json({ error: error.message });
  }

  return NextResponse.json({ ok: true });

}