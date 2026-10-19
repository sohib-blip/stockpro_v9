import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import {
  accessoryWriteError,
  parseAccessoryBinInput,
} from "@/lib/accessory-bin-input";

export const runtime = "nodejs";

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

export async function POST(req: Request) {
  const body = await req.json().catch(() => null);
  const id = (body as { id?: unknown } | null)?.id;

  if (!id || typeof id !== "string") {
    return NextResponse.json({ ok: false, error: "id required" }, { status: 400 });
  }

  const input = parseAccessoryBinInput(body);
  if (!input.ok) {
    return NextResponse.json({ ok: false, error: input.error }, { status: 400 });
  }

  const { error } = await supabase
    .from("accessory_bins")
    .update({
      name: input.name,
      current_stock: input.currentStock,
      minimum_stock: input.minimumStock,
      category: input.category,
    })
    .eq("id", id);

  if (error) {
    const failure = accessoryWriteError(error, input.name);
    return NextResponse.json(
      { ok: false, error: failure.error },
      { status: failure.status }
    );
  }

  return NextResponse.json({ ok: true });
}
