"use client";

import { useEffect, useMemo, useState } from "react";
import { createSupabaseBrowserClient } from "@/lib/supabase/client";
import { useToast } from "@/components/ToastProvider";

type Device = {
  canonical_name: string;
  device: string;
};

type ActionMode = "print" | "import" | "both";

export default function LabelsManualPage() {
  const supabase = useMemo(() => createSupabaseBrowserClient(), []);
  const { toast } = useToast();

  const [devices, setDevices] = useState<Device[]>([]);
  const [device, setDevice] = useState("");
  const [boxNo, setBoxNo] = useState("");
  const [imeiText, setImeiText] = useState("");
  const [mode, setMode] = useState<ActionMode>("print");
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    supabase
      .from("devices")
      .select("canonical_name, device")
      .order("device")
      .then(({ data }) => setDevices((data as any) || []));
  }, [supabase]);

  const imeis = useMemo(() => {
    return imeiText
      .split("\n")
      .map((x) => x.replace(/\D/g, ""))
      .filter((x) => x.length === 15);
  }, [imeiText]);

  async function getToken() {
    const { data } = await supabase.auth.getSession();
    return data.session?.access_token || "";
  }

  async function onGenerate() {
    try {
      if (!device || !boxNo || imeis.length === 0) {
        toast({
          kind: "error",
          title: "Champs manquants",
          message: "Device, BoxNR et IMEI sont obligatoires.",
        });
        return;
      }

      setLoading(true);
      const token = await getToken();

      const res = await fetch("/api/labels/manual", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({
          device,
          box_no: boxNo,
          imeis,
          mode,
        }),
      });

      if (!res.ok) {
        const j = await res.json().catch(() => null);
        throw new Error(j?.error || "Erreur serveur");
      }

      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `label-${device}-${boxNo}.pdf`;
      a.click();
      URL.revokeObjectURL(url);

      toast({
        kind: "success",
        title: "Label généré",
        message: `${imeis.length} IMEI`,
      });
    } catch (e: any) {
      toast({ kind: "error", title: "Erreur", message: e.message });
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="space-y-6 max-w-3xl">
      <div>
        <div className="text-xs text-slate-500">Labels</div>
        <h2 className="text-xl font-semibold">Création manuelle de labels</h2>
      </div>

      <div className="bg-slate-900 border border-slate-800 rounded-2xl p-4 space-y-4">
        <div>
          <label className="text-sm">Device</label>
          <select
            value={device}
            onChange={(e) => setDevice(e.target.value)}
            className="w-full mt-1 bg-slate-950 border border-slate-800 rounded-xl px-3 py-2"
          >
            <option value="">— choisir —</option>
            {devices.map((d) => (
              <option key={d.canonical_name} value={d.device}>
                {d.device}
              </option>
            ))}
          </select>
        </div>

        <div>
          <label className="text-sm">BoxNR</label>
          <input
            value={boxNo}
            onChange={(e) => setBoxNo(e.target.value)}
            placeholder="076-004"
            className="w-full mt-1 bg-slate-950 border border-slate-800 rounded-xl px-3 py-2"
          />
        </div>

        <div>
          <label className="text-sm">IMEI (1 par ligne)</label>
          <textarea
            value={imeiText}
            onChange={(e) => setImeiText(e.target.value)}
            rows={8}
            className="w-full mt-1 bg-slate-950 border border-slate-800 rounded-xl px-3 py-2 font-mono text-sm"
          />
          <div className="text-xs text-slate-400 mt-1">
            {imeis.length} IMEI valides détectés
          </div>
        </div>

        <div>
          <label className="text-sm">Action</label>
          <select
            value={mode}
            onChange={(e) => setMode(e.target.value as ActionMode)}
            className="w-full mt-1 bg-slate-950 border border-slate-800 rounded-xl px-3 py-2"
          >
            <option value="print">Imprimer seulement</option>
            <option value="import">Importer seulement</option>
            <option value="both">Importer + imprimer</option>
          </select>
        </div>

        <button
          onClick={onGenerate}
          disabled={loading}
          className="w-full bg-indigo-600 hover:bg-indigo-700 rounded-xl px-4 py-3 font-semibold"
        >
          {loading ? "Génération…" : "Générer le label PDF"}
        </button>
      </div>
    </div>
  );
}