import { NextResponse } from "next/server";
import { getApiIdentity } from "@/lib/api-identity";
import { supabaseService } from "@/lib/auth";
import { packagingCreateSchema } from "@/lib/packaging-validation";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  try {
    const parsed = packagingCreateSchema.safeParse(
      await req.json().catch(() => null)
    );
    if (!parsed.success) {
      return NextResponse.json(
        { ok: false, error: "Invalid packaging details" },
        { status: 400 }
      );
    }

    const identity = getApiIdentity(req);
    const { data, error } = await supabaseService()
      .from("packaging_types")
      .insert({
        ...parsed.data,
        on_hand_stock: 0,
        reserved_stock: 0,
        active: true,
        created_by_id: identity.userId,
        created_by_email: identity.email,
        updated_by_id: identity.userId,
        updated_by_email: identity.email,
      })
      .select("id,code,name")
      .single();

    if (error) {
      if (error.code === "23505") {
        return NextResponse.json(
          { ok: false, error: "A packaging format with this code or name already exists" },
          { status: 409 }
        );
      }
      throw error;
    }

    return NextResponse.json({ ok: true, row: data }, { status: 201 });
  } catch (error) {
    console.error("PACKAGING CREATE ERROR", error);
    return NextResponse.json(
      { ok: false, error: "Packaging format could not be created" },
      { status: 500 }
    );
  }
}
