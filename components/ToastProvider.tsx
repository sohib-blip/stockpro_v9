"use client";

import React, { createContext, useCallback, useContext, useMemo, useState } from "react";

export type ToastKind = "success" | "error" | "info";
export type Toast = { id: string; kind: ToastKind; title: string; message?: string; ttlMs?: number };

type ToastCtx = {
  toast: (t: Omit<Toast, "id">) => void;
};

const Ctx = createContext<ToastCtx | null>(null);

function uid() {
  return `${Date.now()}_${Math.random().toString(16).slice(2)}`;
}

export function useToast() {
  const ctx = useContext(Ctx);
  if (!ctx) throw new Error("useToast must be used inside <ToastProvider>");
  return ctx;
}

export default function ToastProvider({ children }: { children: React.ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([]);

  const toast = useCallback((t: Omit<Toast, "id">) => {
    const id = uid();
    const ttl = t.ttlMs ?? 3800;
    setToasts((prev) => [{ id, ...t }, ...prev].slice(0, 5));
    window.setTimeout(() => {
      setToasts((prev) => prev.filter((x) => x.id !== id));
    }, ttl);
  }, []);

  const value = useMemo(() => ({ toast }), [toast]);

  return (
    <Ctx.Provider value={value}>
      {children}
      <div className="fixed right-4 top-4 z-[100] space-y-2">
        {toasts.map((t) => (
          <div
            key={t.id}
            className={
              "w-[340px] rounded-2xl border p-3 shadow-lg backdrop-blur " +
              (t.kind === "success"
                ? "border-emerald-900/60 bg-emerald-950/60"
                : t.kind === "error"
                  ? "border-rose-900/60 bg-rose-950/60"
                  : "border-slate-800 bg-slate-950/60")
            }
          >
            <div className="text-sm font-semibold text-slate-100">{t.title}</div>
            {t.message ? <div className="mt-1 text-xs text-slate-300">{t.message}</div> : null}
          </div>
        ))}
      </div>
    </Ctx.Provider>
  );
}
