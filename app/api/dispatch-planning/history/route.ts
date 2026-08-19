import { NextResponse } from "next/server";
import { z } from "zod";
import { supabaseService } from "@/lib/auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const revalidate = 0;

export async function GET(req: Request) {
  try {
    const id = new URL(req.url).searchParams.get("id");
    const parsedId = id ? z.string().uuid().safeParse(id) : null;
    if (id && !parsedId?.success) {
      return NextResponse.json(
        { ok: false, error: "Invalid dispatch batch." },
        { status: 400 }
      );
    }

    const service = supabaseService();
    if (parsedId?.success) {
      const { data, error } = await service
        .from("dispatch_batches")
        .select("*")
        .eq("id", parsedId.data)
        .maybeSingle();
      if (error) throw error;
      if (!data) {
        return NextResponse.json(
          { ok: false, error: "Dispatch batch not found." },
          { status: 404 }
        );
      }
      return NextResponse.json({ ok: true, row: data });
    }

    const { data, error } = await service
      .from("dispatch_batches")
      .select(
        "id,source_filename,source_generated_at,status,order_count,line_count,total_packages,package_usage,actor_email,confirmed_at,undone_at,undone_by_email"
      )
      .order("confirmed_at", { ascending: false })
      .limit(100);
    if (error) throw error;
    return NextResponse.json({ ok: true, rows: data || [] });
  } catch (error) {
    console.error("DISPATCH HISTORY ERROR", error);
    return NextResponse.json(
      { ok: false, error: "Dispatch history could not be loaded." },
      { status: 500 }
    );
  }
}
