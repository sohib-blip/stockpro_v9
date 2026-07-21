"use client";

import React, { createContext, useCallback, useContext, useMemo, useState } from "react";
import { CheckCircle2, Info, XCircle } from "lucide-react";

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
      <div className="fixed right-4 top-4 z-[100] max-w-[calc(100vw-2rem)] space-y-2">
        {toasts.map((t) => (
          <div
            key={t.id}
            className="sp-card sp-card-tight w-[340px] max-w-full"
          >
            <div className="flex items-start gap-3">
              {t.kind === "success" ? (
                <CheckCircle2 aria-hidden="true" className="mt-0.5 size-4 shrink-0 text-sp-ok" />
              ) : t.kind === "error" ? (
                <XCircle aria-hidden="true" className="mt-0.5 size-4 shrink-0 text-sp-err" />
              ) : (
                <Info aria-hidden="true" className="mt-0.5 size-4 shrink-0 text-sp-info" />
              )}
              <div>
                <div className="text-sm font-semibold text-sp-text">{t.title}</div>
                {t.message ? <div className="mt-1 text-xs text-sp-secondary">{t.message}</div> : null}
              </div>
            </div>
          </div>
        ))}
      </div>
    </Ctx.Provider>
  );
}
