import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { loadSupplyOrdersWithItems } from "@/lib/supply-orders";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const revalidate = 0;

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

export async function GET() {
  try {
    const rows = await loadSupplyOrdersWithItems(supabase);

        return NextResponse.json(
      {
        ok: true,
        rows,
      },
      {
        headers: {
          "Cache-Control":
            "no-store, no-cache, must-revalidate, proxy-revalidate",
          Pragma: "no-cache",
          Expires: "0",
        },
      }
    );
  } catch (e: any) {
    return NextResponse.json(
      {
        ok: false,
        error: e?.message || "Supply list failed",
      },
      { status: 500 }
    );
  }
}
