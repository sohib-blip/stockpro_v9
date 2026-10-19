import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { isMissingDispatchColumns } from "@/app/api/dispatch-planning/_server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const revalidate = 0;

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

export async function GET(req: Request) {
  const url = new URL(req.url);
  const includeHidden = url.searchParams.get("include_hidden") === "1";

  const BASE_COLUMNS = "id, name, category, active, created_at, current_stock, minimum_stock";
  const listAccessories = (columns: string) => {
    let query = supabase
      .from("accessory_bins")
      .select(columns)
      .or("category.is.null,category.neq.Packages")
      .order("name", { ascending: true });
    if (!includeHidden) query = query.eq("active", true);
    return query;
  };

  let { data, error } = await listAccessories(
    `${BASE_COLUMNS}, length_cm, width_cm, height_cm, kinesis_names`
  );
  // Before the dispatch dimension migration, the list works without them.
  if (error && isMissingDispatchColumns(error)) {
    ({ data, error } = await listAccessories(BASE_COLUMNS));
  }

  if (error) {
    return NextResponse.json({ ok: false, error: error.message }, { status: 500 });
  }

  return NextResponse.json({ ok: true, rows: data || [] });
}
