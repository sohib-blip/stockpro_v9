import { NextResponse } from "next/server";
import { getApiIdentity } from "@/lib/api-identity";
import { supabaseService } from "@/lib/auth";
import { packagingToggleSchema } from "@/lib/packaging-validation";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  try {
    const parsed = packagingToggleSchema.safeParse(
      await req.json().catch(() => null)
    );
    if (!parsed.success) {
      return NextResponse.json(
        { ok: false, error: "Invalid packaging visibility request" },
        { status: 400 }
      );
    }

    const identity = getApiIdentity(req);
    const { data, error } = await supabaseService()
      .from("packaging_types")
      .update({
        active: parsed.data.active,
        updated_at: new Date().toISOString(),
        updated_by_id: identity.userId,
        updated_by_email: identity.email,
      })
      .eq("id", parsed.data.id)
      .select("id,name,active")
      .maybeSingle();

    if (error) throw error;
    if (!data) {
      return NextResponse.json(
        { ok: false, error: "Packaging format not found" },
        { status: 404 }
      );
    }

    return NextResponse.json({ ok: true, row: data });
  } catch (error) {
    console.error("PACKAGING TOGGLE ERROR", error);
    return NextResponse.json(
      { ok: false, error: "Packaging visibility could not be updated" },
      { status: 500 }
    );
  }
}
