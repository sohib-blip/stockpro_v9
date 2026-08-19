import { NextResponse } from "next/server";
import { getApiIdentity } from "@/lib/api-identity";
import { supabaseService } from "@/lib/auth";
import { packagingUpdateSchema } from "@/lib/packaging-validation";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  try {
    const parsed = packagingUpdateSchema.safeParse(
      await req.json().catch(() => null)
    );
    if (!parsed.success) {
      return NextResponse.json(
        { ok: false, error: "Invalid packaging details" },
        { status: 400 }
      );
    }

    const identity = getApiIdentity(req);
    const { id, ...changes } = parsed.data;
    const { data, error } = await supabaseService()
      .from("packaging_types")
      .update({
        ...changes,
        updated_at: new Date().toISOString(),
        updated_by_id: identity.userId,
        updated_by_email: identity.email,
      })
      .eq("id", id)
      .select("id,code,name")
      .maybeSingle();

    if (error) {
      if (error.code === "23505") {
        return NextResponse.json(
          { ok: false, error: "A packaging format with this code or name already exists" },
          { status: 409 }
        );
      }
      throw error;
    }
    if (!data) {
      return NextResponse.json(
        { ok: false, error: "Packaging format not found" },
        { status: 404 }
      );
    }

    return NextResponse.json({ ok: true, row: data });
  } catch (error) {
    console.error("PACKAGING UPDATE ERROR", error);
    return NextResponse.json(
      { ok: false, error: "Packaging format could not be updated" },
      { status: 500 }
    );
  }
}
