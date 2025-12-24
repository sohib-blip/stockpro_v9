"use client";

import Link from "next/link";

export default function DeniedPage() {
  return (
    <div className="max-w-xl">
      <div className="text-lg font-semibold text-slate-100">Access denied</div>
      <div className="mt-2 text-sm text-slate-400">
        You don’t have permission to access this page. If you think this is a mistake, ask an admin to update your permissions.
      </div>

      <div className="mt-4 flex gap-2">
        <Link
          href="/dashboard"
          className="px-4 py-2 rounded-lg bg-slate-800 hover:bg-slate-700 border border-slate-700 text-sm font-semibold"
        >
          Go to Dashboard
        </Link>
      </div>
    </div>
  );
}
