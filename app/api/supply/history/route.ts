import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const revalidate = 0;
export const fetchCache = "force-no-store";

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
  {
    auth: {
      persistSession: false,
      autoRefreshToken: false,
    },
  }
);

export async function GET(req: Request) {
  try {
    const { searchParams } = new URL(req.url);
    const id = searchParams.get("id")?.trim();

    if (!id) {
      return NextResponse.json(
        {
          ok: false,
          error: "Missing supply id",
        },
        {
          status: 400,
          headers: {
            "Cache-Control": "no-store, no-cache, must-revalidate",
          },
        }
      );
    }

    const { data, error } = await supabase
      .from("supply_status_history")
      .select(
        `
          id,
          supply_id,
          status,
          tracking_number,
          failed_reason,
          changed_by,
          changed_by_id,
          created_at
        `
      )
      .eq("supply_id", id)
      .order("created_at", { ascending: true });

    if (error) {
      console.error("SUPPLY HISTORY ERROR:", error);
      throw error;
    }

    console.log(
      "HISTORY RESULT:",
      id,
      data?.map((row) => ({
        status: row.status,
        created_at: row.created_at,
      }))
    );

    return NextResponse.json(
      {
        ok: true,
        rows: data ?? [],
      },
      {
        status: 200,
        headers: {
          "Cache-Control": "no-store, no-cache, must-revalidate, proxy-revalidate",
          Pragma: "no-cache",
          Expires: "0",
        },
      }
    );
  } catch (e: any) {
    console.error("SUPPLY HISTORY FAILED:", e);

    return NextResponse.json(
      {
        ok: false,
        error: e?.message || "Supply history failed",
      },
      {
        status: 500,
        headers: {
          "Cache-Control": "no-store",
        },
      }
    );
  }
}