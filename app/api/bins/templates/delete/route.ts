import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { errorMessage } from "@/lib/error-message";

export const runtime = "nodejs";

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

export async function POST(req: Request) {
  try {
    const { id } = await req.json();

    if (!id) {
      return NextResponse.json(
        { ok: false, error: "template id required" },
        { status: 400 }
      );
    }

    const { error } = await supabase
      .from("device_accessory_templates")
      .delete()
      .eq("id", id);

    if (error) throw error;

    return NextResponse.json({ ok: true });
  } catch (e) {
    return NextResponse.json(
      { ok: false, error: errorMessage(e, "Delete template failed") },
      { status: 500 }
    );
  }
}