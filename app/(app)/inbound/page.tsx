"use client";

import { useState } from "react";
import { createSupabaseBrowserClient } from "@/lib/supabase/client";
import { useToast } from "@/components/ToastProvider";
import { LOCATIONS } from "@/lib/device";

export default function InboundPage() {
  const supabase = createSupabaseBrowserClient();
  const { toast } = useToast();

  const [file, setFile] = useState<File | null>(null);
  const [location, setLocation] = useState("00");

  async function submit() {
    if (!file) return;

    const { data } = await supabase.auth.getSession();
    const token = data.session?.access_token;
    if (!token) return;

    const fd = new FormData();
    fd.append("file", file);
    fd.append("location", location);

    const res = await fetch("/api/inbound/commit", {
      method: "POST",
      headers: { Authorization: `Bearer ${token}` },
      body: fd,
    });

    const json = await res.json();
    if (!json.ok) {
      toast({ kind: "error", title: json.error });
      return;
    }

    toast({ kind: "success", title: "Import réussi" });
  }

  return (
    <div className="space-y-6">
      <h1 className="text-xl font-semibold">Inbound Import</h1>

      <select
        value={location}
        onChange={(e) => setLocation(e.target.value)}
        className="bg-slate-950 border border-slate-800 rounded-xl px-3 py-2"
      >
        {LOCATIONS.map((l) => (
          <option key={l} value={l}>
            {l}
          </option>
        ))}
      </select>

      <input
        type="file"
        onChange={(e) => setFile(e.target.files?.[0] || null)}
      />

      <button
        onClick={submit}
        className="bg-emerald-600 px-4 py-2 rounded-xl"
      >
        Importer
      </button>
    </div>
  );
}