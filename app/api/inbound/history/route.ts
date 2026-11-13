import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { errorMessage } from "@/lib/error-message";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const revalidate = 0;

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const SERVICE_ROLE = process.env.SUPABASE_SERVICE_ROLE_KEY!;

function sb() {
  return createClient(SUPABASE_URL, SERVICE_ROLE, {
    auth: { persistSession: false },
  });
}

// Columns of inbound_history_view (the query selects them all). boxes and
// imeis are older column names the response still falls back to.
type InboundHistoryRow = {
  batch_id: string;
  created_at: string | null;
  actor: string | null;
  vendor: string | null;
  source: string | null;
  shipment_ref: string | null;
  qty_boxes: number | null;
  qty_imeis: number | null;
  boxes?: number | null;
  imeis?: number | null;
};

export async function GET(req: Request) {
  try {
    const supabase = sb();

    const url = new URL(req.url);
    const page = Number(url.searchParams.get("page") || 1);

    const limit = 50;
    const offset = (page - 1) * limit;

    const { data, error } = await supabase
      .from("inbound_history_view")
      .select("*")
      .order("created_at", { ascending: false })
      .range(offset, offset + limit - 1);

    if (error) throw error;

    const rows = (data || [])
      .map((r: InboundHistoryRow) => ({
        ...r,

        // Keep the response compatible with the inbound history table.
        qty_boxes: r.qty_boxes ?? r.boxes ?? 0,
        qty_imeis: r.qty_imeis ?? r.imeis ?? 0,
      }))
      // Legacy duplicate attempts created zero-item batches. They are not
      // warehouse events and must not appear as downloadable history.
      .filter((row) => Number(row.qty_imeis) > 0);

    return NextResponse.json({
      ok: true,
      rows,
      page,
    });

  } catch (e) {
    return NextResponse.json(
      { ok: false, error: errorMessage(e, "History failed") },
      { status: 500 }
    );
  }
}
