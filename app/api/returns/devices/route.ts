import { NextResponse } from "next/server";
import { supabaseService } from "@/lib/auth";
import { mergeReturnDeviceOptions } from "@/lib/returns";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const revalidate = 0;

export async function GET() {
  try {
    const { data, error } = await supabaseService()
      .from("bins")
      .select("name")
      .order("name", { ascending: true });

    if (error) throw error;

    return NextResponse.json({
      ok: true,
      devices: mergeReturnDeviceOptions(
        (data || []).map((row) => String(row.name || ""))
      ),
    });
  } catch (error) {
    console.error("RETURN DEVICES ERROR", error);
    return NextResponse.json(
      { ok: false, error: "Unable to load return devices" },
      { status: 500 }
    );
  }
}
