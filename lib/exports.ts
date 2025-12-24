import type { SupabaseClient } from "@supabase/supabase-js";

function downloadCsv(filename: string, csv: string) {
  const blob = new Blob([csv], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

function esc(v: any) {
  const s = String(v ?? "");
  // CSV safe
  return `"${s.replace(/"/g, '""')}"`;
}

export async function exportInStockByDevice(supabase: SupabaseClient, toast?: any) {
  try {
    // adapte les noms de tables/colonnes si nécessaire
    const { data, error } = await supabase
      .from("items")
      .select("device, master_box_no, box_no, imei, status, created_at")
      .eq("status", "IN")
      .order("device", { ascending: true });

    if (error) throw error;

    const rows = data ?? [];
    const header = ["device", "master_box_no", "box_no", "imei", "status", "created_at"];

    const csv =
      header.map(esc).join(",") +
      "\n" +
      rows
        .map((r: any) => header.map((k) => esc(r[k])).join(","))
        .join("\n");

    downloadCsv(`stock_in_${new Date().toISOString().slice(0, 10)}.csv`, csv);

    toast?.success?.("Export téléchargé ✅");
  } catch (e: any) {
    toast?.error?.(e?.message ?? "Export failed");
    throw e;
  }
}
