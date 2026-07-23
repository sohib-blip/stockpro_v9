import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { resolveApiUserEmail } from "@/lib/api-identity";

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

function getMonthRange(periodMonth?: string | null) {
  const now = new Date();

  const month =
    periodMonth && /^\d{4}-\d{2}$/.test(periodMonth)
      ? periodMonth
      : `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;

  const [year, monthNumber] = month.split("-").map(Number);

  const start = new Date(Date.UTC(year, monthNumber - 1, 1));
  const end = new Date(Date.UTC(year, monthNumber, 1));

  return {
    start: start.toISOString(),
    end: end.toISOString(),
  };
}

export async function GET(req: Request) {
  try {
    const url = new URL(req.url);

    const userEmail = resolveApiUserEmail(
      req,
      url.searchParams.get("user_email")
    );
    const periodMonth = url.searchParams.get("period_month");

    const range = getMonthRange(periodMonth);

    const { data, error } = await supabase
      .from("nrd_time_logs")
      .select("*")
      .eq("user_email", userEmail)
      .not("ended_at", "is", null)
      .gte("started_at", range.start)
      .lt("started_at", range.end)
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
