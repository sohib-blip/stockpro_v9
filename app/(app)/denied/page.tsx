"use client";

import Link from "next/link";

export default function DeniedPage() {
  return (
    <div className="access-denied-card">
      <div className="access-denied-icon"><span /></div>
      <h1>You don&apos;t have access to this page</h1>
      <div>
        Your account doesn&apos;t include this module. If you need it, ask an administrator to update your permissions.
      </div>

      <div className="mt-4 flex gap-2">
        <Link
          href="/dashboard"
          className="prototype-button primary"
        >
          Go to Dashboard
        </Link>
      </div>
    </div>
  );
}
