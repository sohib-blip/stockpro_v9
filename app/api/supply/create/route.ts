import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { getApiIdentity } from "@/lib/api-identity";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

function makeOrderNumber() {
  const now = new Date();

  const y = now.getFullYear();
  const m = String(now.getMonth() + 1).padStart(2, "0");
  const d = String(now.getDate()).padStart(2, "0");
  const rand = Math.floor(1000 + Math.random() * 9000);

  return `SUP-${y}${m}${d}-${rand}`;
}

export async function POST(req: Request) {
  try {
    const body = await req.json();

    const {
      from_office,
      to_office,
      comment,
      items,
    } = body;
    const identity = getApiIdentity(req);

    if (!from_office || !to_office) {
      return NextResponse.json(
        { ok: false, error: "From office and To office are required" },
        { status: 400 }
      );
    }

    if (!Array.isArray(items) || items.length === 0) {
      return NextResponse.json(
        { ok: false, error: "At least one item is required" },
        { status: 400 }
      );
    }

    const order_number = makeOrderNumber();

    const { data: supply, error: supplyError } = await supabase
      .from("supplies")
      .insert({
        order_number,
        from_office,
        to_office,
        tracking_number: null,
        status: "CREATED",
        imported: false,
        imported_date: null,
        comment: comment || null,
        created_by: identity.email,
        created_by_id: identity.userId,
      })
      .select("*")
      .single();

    if (supplyError) throw supplyError;

    await supabase.from("supply_status_history").insert({
      supply_id: supply.id,
      status: "CREATED",
      tracking_number: null,
      changed_by: identity.email,
      changed_by_id: identity.userId,
    });

    const cleanItems = items
      .filter((item: any) => item.product_name && Number(item.qty) > 0)
      .map((item: any) => ({
        supply_id: supply.id,
        product_id: item.product_id || null,
        product_type: item.product_type,
        product_name: item.product_name,
        qty: Number(item.qty),
      }));

    if (cleanItems.length === 0) {
      return NextResponse.json(
        { ok: false, error: "No valid items provided" },
        { status: 400 }
      );
    }

    const { error: itemsError } = await supabase
      .from("supply_items")
      .insert(cleanItems);

    if (itemsError) throw itemsError;

    return NextResponse.json({
      ok: true,
      supply,
    });
  } catch (e: any) {
    return NextResponse.json(
      { ok: false, error: e?.message || "Supply create failed" },
      { status: 500 }
    );
  }
}
