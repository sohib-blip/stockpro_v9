import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const revalidate = 0;

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

async function loadRuleCounts() {
  const { data, error } = await supabase
    .from("device_accessory_templates")
    .select("device_id");
  if (error) throw error;

  const counts: Record<string, number> = {};
  for (const row of data || []) {
    const deviceId = String((row as { device_id: string }).device_id);
    counts[deviceId] = (counts[deviceId] || 0) + 1;
  }
  return counts;
}

export async function GET(req: Request) {
  const url = new URL(req.url);
  const deviceId = url.searchParams.get("device_id");

  // Without a device, only the number of rules per device bin is returned.
  if (!deviceId) {
    try {
      return NextResponse.json({ ok: true, rule_counts: await loadRuleCounts() });
    } catch (error: any) {
      return NextResponse.json(
        { ok: false, error: error?.message || "Automatic accessory rules could not be loaded" },
        { status: 500 }
      );
    }
  }

  const [
    { data: device },
    { data: accessories },
    { data: templates, error },
    ruleCounts,
  ] = await Promise.all([
    supabase.from("bins").select("id, name").eq("id", deviceId).single(),

    supabase
      .from("accessory_bins")
      .select("id, name")
      .eq("active", true)
      .order("name"),

    supabase
      .from("device_accessory_templates")
      .select("id, device_id, accessory_bin_id, quantity, per_devices, created_at")
      .eq("device_id", deviceId)
      .order("created_at", { ascending: false }),

    loadRuleCounts().catch(() => null),
  ]);

  if (error) {
    return NextResponse.json(
      { ok: false, error: error.message },
      { status: 500 }
    );
  }

  const accessoryMap = new Map(
    (accessories || []).map((a: any) => [a.id, a])
  );

  const templatesWithAccessories = (templates || []).map((t: any) => ({
    ...t,
    accessory_bins: accessoryMap.get(t.accessory_bin_id) || null,
  }));

  return NextResponse.json({
    ok: true,
    device,
    accessories: accessories || [],
    templates: templatesWithAccessories,
    rule_counts: ruleCounts,
  });
}
