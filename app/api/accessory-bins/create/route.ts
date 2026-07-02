import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

export const runtime = "nodejs";

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

export async function POST(req: Request) {
  try {
    const { name } = await req.json();

    if (!name?.trim()) {
      return NextResponse.json(
        { ok: false, error: "Bin name is required" },
        { status: 400 }
      );
    }

    const { error } = await supabase
      .from("accessory_bins")
      .insert({ name: name.trim() });

    if (error) throw error;

    return NextResponse.json({ ok: true });
  } catch (e: any) {
    return NextResponse.json(
      { ok: false, error: e?.message || "Create accessory bin failed" },
      { status: 500 }
    );
  }
}