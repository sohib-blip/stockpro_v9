import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const revalidate = 0;

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
  {
    auth: { persistSession: false },
  }
);

export async function GET(req: Request) {
  try {
    const url = new URL(req.url);

    const userEmail = url.searchParams.get("user_email");

    if (!userEmail) {
      return NextResponse.json(
        { ok: false, error: "Missing user_email" },
        { status: 400 }
      );
    }

    const { data, error } = await supabase
      .from("nrd_time_logs")
      .select("*")
      .eq("user_email", userEmail)
      .not("ended_at", "is", null)
      .order("started_at", { ascending: false })
      .limit(100);

    if (error) throw error;

    return NextResponse.json({
      ok: true,
      rows: data || [],
    });
  } catch (e: any) {
    return NextResponse.json(
      {
        ok: false,
        error: e?.message || "History failed",
      },
      { status: 500 }
    );
  }
}