import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import {
  errorMessage,
  readAllPages,
  rowsOrThrow,
} from "@/lib/supabase/read-all-pages";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const revalidate = 0;

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

async function loadRuleCounts() {
  const data = await readAllPages((from, to) =>
    supabase
      .from("device_accessory_templates")
      .select("id, device_id")
      .order("id", { ascending: true })
      .range(from, to)
      .then(rowsOrThrow)
  );

  const counts: Record<string, number> = {};
  for (const row of data) {
    const deviceId = String((row as { device_id: string }).device_id);
    counts[deviceId] = (counts[deviceId] || 0) + 1;
  }
  return counts;
}

// The device, active accessories, this device's rules and every rule count.
function loadDeviceRules(deviceId: string) {
  return Promise.all([
    supabase.from("bins").select("id, name").eq("id", deviceId).single(),

    readAllPages((from, to) =>
      supabase
        .from("accessory_bins")
        .select("id, name")
        .eq("active", true)
        .order("name")
        .order("id")
        .range(from, to)
        .then(rowsOrThrow)
    ),

    readAllPages((from, to) =>
      supabase
        .from("device_accessory_templates")
        .select("id, device_id, accessory_bin_id, quantity, per_devices, per_order, created_at")
        .eq("device_id", deviceId)
        .order("created_at", { ascending: false })
        .order("id", { ascending: false })
        .range(from, to)
        .then(rowsOrThrow)
    ),

    loadRuleCounts().catch(() => null),
  ]);
}

export async function GET(req: Request) {
  const url = new URL(req.url);
  const deviceId = url.searchParams.get("device_id");

  // Without a device, only the number of rules per device bin is returned.
  if (!deviceId) {
    try {
      return NextResponse.json({ ok: true, rule_counts: await loadRuleCounts() });
    } catch (error) {
      return NextResponse.json(
        { ok: false, error: errorMessage(error, "Automatic accessory rules could not be loaded") },
        { status: 500 }
      );
    }
  }

  let loaded: Awaited<ReturnType<typeof loadDeviceRules>>;
  try {
    loaded = await loadDeviceRules(deviceId);
  } catch (error) {
    return NextResponse.json(
      { ok: false, error: errorMessage(error, "Automatic accessory rules could not be loaded") },
      { status: 500 }
    );
  }
  const [{ data: device }, accessories, templates, ruleCounts] = loaded;

  const accessoryMap = new Map(
    accessories.map((a) => [a.id, a])
  );

  const templatesWithAccessories = templates.map((t) => ({
    ...t,
    accessory_bins: accessoryMap.get(t.accessory_bin_id) || null,
  }));

  return NextResponse.json({
    ok: true,
    device,
    accessories,
    templates: templatesWithAccessories,
    rule_counts: ruleCounts,
  });
}
