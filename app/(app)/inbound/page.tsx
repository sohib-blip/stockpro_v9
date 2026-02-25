"use client";

import { useEffect, useMemo, useState } from "react";
import { createSupabaseBrowserClient } from "@/lib/supabase/client";
import { parseVendorExcel } from "@/lib/inbound/parsers";
import { toDeviceMatchList } from "@/lib/inbound/vendorParser";

type Vendor = "teltonika" | "quicklink" | "digitalmatter" | "truster";
type HistoryFilter = "all" | "excel" | "manual";

type HistoryRow = {
  batch_id: string;
  created_at: string;
  actor: string;
  vendor: string;
  source: string;
  qty: number;
};

type DeviceRow = {
  device_id: string;
  device: string;
};

function normName(s: any) {
  return String(s ?? "").trim().toLowerCase();
}

export default function InboundPage() {
  const supabase = useMemo(() => createSupabaseBrowserClient(), []);

  const [actor, setActor] = useState("unknown");

  const [vendor, setVendor] = useState<Vendor>("teltonika");
  const [file, setFile] = useState<File | null>(null);
  const [floor, setFloor] = useState("00");
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<any>(null);
  const [err, setErr] = useState("");

  const [history, setHistory] = useState<HistoryRow[]>([]);
  const [loadingHistory, setLoadingHistory] = useState(false);
  const [historyFilter, setHistoryFilter] = useState<HistoryFilter>("all");

  const [lastBatchId, setLastBatchId] = useState<string>("");

  const [devices, setDevices] = useState<DeviceRow[]>([]);
  const [binNameToId, setBinNameToId] = useState<Record<string, string>>({});

  const [manualDevice, setManualDevice] = useState<string>("");
  const [manualBox, setManualBox] = useState<string>("");
  const [manualFloor, setManualFloor] = useState<string>("00");
  const [manualImeis, setManualImeis] = useState<string>("");

  const [manualPreview, setManualPreview] = useState<any>(null);
  const [manualMsg, setManualMsg] = useState<string>("");

  const LABEL_W = 100;
  const LABEL_H = 50;

  useEffect(() => {
    (async () => {
      const { data } = await supabase.auth.getUser();
      const email = data?.user?.email;
      if (email) setActor(email);
    })();
  }, [supabase]);

  async function loadDevices() {
    const { data } = await supabase
      .from("bins")
      .select("id, name, active")
      .eq("active", true)
      .order("name", { ascending: true });

    const list = (data as any[]) || [];

    const mapped: DeviceRow[] = list.map((b: any) => ({
      device_id: String(b.id),
      device: String(b.name),
    }));

    setDevices(mapped);

    const map: Record<string, string> = {};
    list.forEach((b: any) => {
      map[normName(b.name)] = String(b.id);
    });

    setBinNameToId(map);

    if (!manualDevice && mapped.length > 0) {
      setManualDevice(mapped[0].device_id);
    }
  }

  async function loadHistory() {
    setLoadingHistory(true);
    try {
      const res = await fetch("/api/inbound/history", { cache: "no-store" });
      const json = await res.json();
      setHistory(json.ok ? json.rows : []);
    } finally {
      setLoadingHistory(false);
    }
  }

  useEffect(() => {
    loadHistory();
    loadDevices();
  }, []);

  function fmtDateTime(iso: string) {
    try {
      return new Date(iso).toLocaleString();
    } catch {
      return iso;
    }
  }

  // ========== EXCEL FLOW ==========
  async function parseExcel() {
    setErr("");
    setResult(null);
    setLastBatchId("");
    setManualPreview(null);
    setManualMsg("");

    if (!file) return setErr("Choose a file.");

    setBusy(true);
    try {
      const bytes = new Uint8Array(await file.arrayBuffer());

      const fakeDevices = devices.map((d) => ({
        device_id: d.device_id,
        canonical_name: d.device,
        device: d.device,
        active: true,
        units_per_imei: 1,
      }));

      const parsed = parseVendorExcel(
        vendor,
        bytes,
        toDeviceMatchList(fakeDevices as any)
      );

      if (parsed?.ok) {
        parsed.labels = parsed.labels.map((l: any) => ({
          ...l,
          floor,
        }));

        const devicesFound = new Set<string>();
        const boxAgg: Record<string, { imeis: number; device: string }> = {};
        const unknownBins: string[] = [];

        for (const l of parsed.labels || []) {
          const deviceName = String(l.device || "").trim();
          const boxNo = String(l.box_no || "").trim();
          const imeiCount = l.imeis?.length || 0;

          if (deviceName) devicesFound.add(deviceName);

          if (deviceName && !binNameToId[normName(deviceName)]) {
            unknownBins.push(deviceName);
          }

          if (boxNo) {
            if (!boxAgg[boxNo]) {
              boxAgg[boxNo] = { imeis: 0, device: deviceName };
            }
            boxAgg[boxNo].imeis += imeiCount;
          }
        }

        (parsed as any).devices_found = Array.from(devicesFound);
        (parsed as any).unknown_bins_preview = Array.from(new Set(unknownBins));
        (parsed as any).box_breakdown = Object.entries(boxAgg).map(
          ([box_no, v]) => ({
            box_no,
            imeis: v.imeis,
            device: v.device,
          })
        );
      }

      setResult(parsed);
    } catch (e: any) {
      setErr(e?.message || "Parse failed");
    } finally {
      setBusy(false);
    }
  }

  async function confirmExcelInbound() {
    if (!result?.ok) return;

    if ((result?.unknown_bins_preview?.length ?? 0) > 0) {
      setErr("Import blocked: unknown bins detected.");
      return;
    }

    const labelsConverted = result.labels.map((l: any) => ({
      device: binNameToId[normName(l.device)],
      box_no: l.box_no,
      floor: l.floor,
      imeis: l.imeis,
    }));

    setBusy(true);
    setErr("");

    try {
      const res = await fetch("/api/inbound/confirm", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ labels: labelsConverted, actor, vendor }),
      });

      const json = await res.json();

      if (!json.ok) throw new Error(json.error);

      setLastBatchId(json.batch_id);
      setResult(null);
      setFile(null);

      await loadHistory();
    } catch (e: any) {
      setErr(e?.message || "Confirm failed");
    } finally {
      setBusy(false);
    }
  }

  const excelTotals = result?.ok
    ? {
        boxes: result.labels.length,
        imeis: result.labels.reduce(
          (a: number, l: any) => a + (l.imeis?.length || 0),
          0
        ),
      }
    : { boxes: 0, imeis: 0 };

  const filteredHistory = history.filter((h) => {
    if (historyFilter === "all") return true;
    if (historyFilter === "manual")
      return h.vendor.toLowerCase() === "manual";
    return h.vendor.toLowerCase() !== "manual";
  });

  return (
    <div className="space-y-8 max-w-5xl">
      {/* ... Ton layout complet original ici inchangé ... */}
    </div>
  );
}