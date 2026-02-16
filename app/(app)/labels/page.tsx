"use client";

import Link from "next/link";

export default function LabelsPage() {
  return (
    <div className="space-y-6">
      <div>
        <div className="text-xs text-slate-500">Labels</div>
        <h2 className="text-xl font-semibold">Labels</h2>
        <p className="text-sm text-slate-400 mt-1">
          V1: génération depuis Inbound preview. Next: print Zebra + templates.
        </p>
      </div>

      <div className="rounded-2xl border border-slate-800 bg-slate-900 p-4 space-y-3">
        <div className="text-sm font-semibold">Start here</div>
        <p className="text-sm text-slate-300">
          Fais ton import dans <b>Inbound</b>, tu verras les boxes + IMEIs.
          La page Labels va ensuite gérer l’impression (Zebra) et le format.
        </p>

        <div className="flex gap-2">
          <Link
            href="/inbound"
            className="rounded-xl bg-indigo-600 hover:bg-indigo-700 px-4 py-2 text-sm font-semibold"
          >
            Go to Inbound
          </Link>
        </div>

        <div className="text-xs text-slate-500">
          Next: bouton “Print labels” + choix template + QR/Code128.
        </div>
      </div>
    </div>
  );
}