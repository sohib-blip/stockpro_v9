import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

export const runtime = "nodejs";

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const SERVICE_ROLE = process.env.SUPABASE_SERVICE_ROLE_KEY!;

function sb() {
  return createClient(SUPABASE_URL, SERVICE_ROLE, {
    auth: { persistSession: false },
  });
}

export async function POST(req: Request) {
  try {
    const { device, box_no, floor, imeis } = await req.json();

    if (!device || !box_no || !Array.isArray(imeis)) {
      return NextResponse.json(
        { ok: false, error: "Missing fields" },
        { status: 400 }
      );
    }

    const cleaned = Array.from(
      new Set(
        imeis
          .map((i: string) => String(i).replace(/\D/g, ""))
          .filter((i: string) => i.length === 15)
      )
    );

    if (cleaned.length === 0) {
      return NextResponse.json(
        { ok: false, error: "No valid 15-digit IMEIs found" },
        { status: 400 }
      );
    }

    const supabase = sb();

    const { data: existing } = await supabase
      .from("items")
      .select("imei")
      .in("imei", cleaned);

    const existingSet = new Set(
      (existing || []).map((x: any) => String(x.imei))
    );

    const duplicates = cleaned.filter((i) => existingSet.has(i));
    const newOnes = cleaned.filter((i) => !existingSet.has(i));

    return NextResponse.json({
      ok: true,
      device,
      box_no,
      floor,
      total_scanned: cleaned.length,
      valid_new: newOnes.length,
      duplicates: duplicates.length,
      duplicate_list: duplicates,
      preview_imeis: newOnes,
    });
  } catch (e: any) {
    return NextResponse.json(
      { ok: false, error: e?.message || "Preview failed" },
      { status: 500 }
    );
  }
}