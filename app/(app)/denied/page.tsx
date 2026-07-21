"use client";

import Link from "next/link";

export default function DeniedPage() {
  return (
    <div className="flex min-h-[55vh] items-center justify-center">
      <section className="sp-card w-full max-w-lg text-center">
        <h1 className="sp-title">Access denied</h1>
        <p className="sp-desc mx-auto max-w-md">
          You don’t have permission to access this page. If you think this is a
          mistake, ask an admin to update your permissions.
        </p>

        <div className="mt-6 flex justify-center">
          <Link href="/dashboard" className="sp-btn sp-btn-primary">
            Go to Dashboard
          </Link>
        </div>
      </section>
    </div>
  );
}
