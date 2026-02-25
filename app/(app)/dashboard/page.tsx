"use client";

import { useEffect, useMemo, useState } from "react";
import { createSupabaseBrowserClient } from "@/lib/supabase/client";
import { Search, Download, AlertTriangle, Pencil, X } from "lucide-react";

type Level = "ok" | "low" | "empty";

type KPI = {
  total_in: number;
  total_out: number;
  total_devices: number;
  total_boxes: number;
  alerts: number;
};

type DeviceSummaryRow = {
  device_id: string;
  device: string;
  total_in: number;
  total_out: number;
  min_stock: number;
  level: Level;
};

type BoxSummaryRow = {
  box_id: string;
  device_id: string;
  device: string;
  box_code: string;
  floor: string | null;
  remaining: number;
  total: number;
  percent: number;
  level: Level;
};

export default function DashboardPage() {
  const supabase = useMemo(() => createSupabaseBrowserClient(), []);

  const [actor, setActor] = useState("unknown");
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState("");

  const [kpi, setKpi] = useState<KPI>({
    total_in: 0,
    total_out: 0,
    total_devices: 0,
    total_boxes: 0,
    alerts: 0,
  });

  const [devices, setDevices] = useState<DeviceSummaryRow[]>([]);
  const [boxes, setBoxes] = useState<BoxSummaryRow[]>([]);

  const [q, setQ] = useState("");
  const [lowOnly, setLowOnly] = useState(false);

  const [editingDeviceId, setEditingDeviceId] = useState<string | null>(null);
  const [minStockDraft, setMinStockDraft] = useState<string>("");

  const [openDeviceId, setOpenDeviceId] = useState<string | null>(null);

  useEffect(() => {
    (async () => {
      const { data } = await supabase.auth.getUser();
      const email = data?.user?.email;
      if (email) setActor(email);
    })();
  }, [supabase]);

  async function loadOverview() {
    setLoading(true);
    setErr("");

    try {
      const res = await fetch(
        `/api/dashboard/overview?t=${Date.now()}`,
        { cache: "no-store" }
      );

      const json = await res.json();

      if (!res.ok || !json?.ok) {
        throw new Error(json?.error || "Failed to load dashboard");
      }

      const kpis: KPI =
        json.kpis || json.kpi || {
          total_in: 0,
          total_out: 0,
          total_devices: 0,
          total_boxes: 0,
          alerts: 0,
        };

      const devs: DeviceSummaryRow[] = (json.deviceSummary || json.devices || []).map((d: any) => ({
        device_id: String(d.device_id ?? ""),
        device: String(d.device ?? ""),
        total_in: Number(d.total_in ?? 0),
        total_out: Number(d.total_out ?? 0),
        min_stock: Number(d.min_stock ?? 0),
        level: (d.level as Level) || "ok",
      }));

      const bxs: BoxSummaryRow[] = (json.boxSummary || json.boxes || []).map((b: any) => ({
        box_id: String(b.box_id ?? b.id ?? ""),
        device_id: String(b.device_id ?? b.bin_id ?? ""),
        device: String(b.device ?? ""),
        box_code: String(b.box_code ?? b.box_no ?? ""),
        floor: b.floor ?? null,
        remaining: Number(b.remaining ?? 0),
        total: Number(b.total ?? 0),
        percent: Number(b.percent ?? 0),
        level: (b.level as Level) || "ok",
      }));

      setKpi(kpis);
      setDevices(devs);
      setBoxes(bxs);
    } catch (e: any) {
      setErr(e?.message || "Failed to load dashboard");
      setKpi({ total_in: 0, total_out: 0, total_devices: 0, total_boxes: 0, alerts: 0 });
      setDevices([]);
      setBoxes([]);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    loadOverview();
  }, []);

  // 🔥 GLOBAL FILTER APPLIES TO BOXES ALSO
  const filteredBoxes = boxes.filter((b) => {
    const s = q.trim().toLowerCase();
    if (!s) return true;
    return (
      b.device.toLowerCase().includes(s) ||
      b.box_code.toLowerCase().includes(s)
    );
  });

  const filteredDevices = devices.filter((d) => {
    const s = q.trim().toLowerCase();
    if (lowOnly && d.level === "ok") return false;
    if (!s) return true;
    return d.device.toLowerCase().includes(s);
  });

  // 🔥 FLOOR WITH REAL COUNTS
  function floorsForDevice(device_id: string) {
    const map: Record<string, { boxes: number; imeis: number }> = {};

    for (const b of filteredBoxes) {
      if (b.device_id !== device_id) continue;

      const floor = b.floor || "—";

      if (!map[floor]) {
        map[floor] = { boxes: 0, imeis: 0 };
      }

      map[floor].boxes += 1;
      map[floor].imeis += b.remaining;
    }

    return Object.entries(map)
      .map(([floor, info]) => `${floor} (${info.boxes} boxes / ${info.imeis} IMEIs)`)
      .join(", ");
  }

  function boxesCountForDevice(device_id: string): number {
    return filteredBoxes.filter(b => b.device_id === device_id).length;
  }

  async function exportExcel() {
    setErr("");
    try {
      const res = await fetch("/api/dashboard/export", { cache: "no-store" });
      const blob = await res.blob();
      const url = window.URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `stock_export_${new Date().toISOString().slice(0, 10)}.xlsx`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      window.URL.revokeObjectURL(url);
    } catch (e: any) {
      setErr(e?.message || "Export failed");
    }
  }

  return (
    <div className="space-y-6 max-w-6xl">
      {/* TOUT TON LAYOUT RESTE EXACTEMENT IDENTIQUE */}
    </div>
  );
}

function KpiCard({
  title,
  value,
  highlight,
}: {
  title: string;
  value: number;
  highlight?: boolean;
}) {
  return (
    <div className="rounded-2xl border border-slate-800 bg-slate-900 p-5">
      <div className="text-xs text-slate-500">{title}</div>
      <div className={"mt-2 text-2xl font-semibold " + (highlight ? "text-amber-200" : "")}>
        {value}
      </div>
    </div>
  );
}