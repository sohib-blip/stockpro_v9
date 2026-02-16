import { NextResponse } from "next/server";
import { requireUserFromBearer, supabaseService } from "@/lib/auth";

export async function GET(req: Request) {
  const u = await requireUserFromBearer(req);
  if (!u.ok) return NextResponse.json({ ok: false, error: u.error }, { status: 401 });

  try {
    const sb = supabaseService();
    const { data, error } = await sb.rpc("dashboard_summary_per_device");
    if (error) throw new Error(error.message);

    return NextResponse.json({
      ok: true,
      per_device: (data || []).map((r: any) => ({
        device: r.device,
        in_stock: Number(r.in_stock ?? 0),
        out_stock: Number(r.out_stock ?? 0),
        total: Number(r.total ?? 0),
      })),
    });
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: e?.message ?? "Summary failed" }, { status: 500 });
  }
}
