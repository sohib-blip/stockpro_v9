import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { parseMinimumStockUpdate } from "@/lib/minimum-stock";

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
  { auth: { persistSession: false } }
);

export async function POST(req: Request) {
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json(
      { ok: false, error: "A valid JSON body is required" },
      { status: 400 }
    );
  }

  const parsed = parseMinimumStockUpdate(body);
  if (!parsed.ok) {
    return NextResponse.json(
      { ok: false, error: parsed.error },
      { status: 400 }
    );
  }

  const { data, error } = await supabase
    .from("bins")
    .update({ min_stock: parsed.minimumStock })
    .eq("id", parsed.deviceId)
    .select("id,min_stock")
    .maybeSingle();

  if (error) {
    return NextResponse.json(
      { ok: false, error: "Unable to update minimum stock" },
      { status: 500 }
    );
  }
  if (!data) {
    return NextResponse.json(
      { ok: false, error: "Device bin not found" },
      { status: 404 }
    );
  }

  return NextResponse.json({ ok: true, row: data });
}
