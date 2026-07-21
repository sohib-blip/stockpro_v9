"use client";

import React, { useEffect } from "react";

export default function ConfirmDialog({
  open,
  title,
  message,
  confirmText = "Confirm",
  cancelText = "Cancel",
  danger,
  onConfirm,
  onCancel,
}: {
  open: boolean;
  title: string;
  message?: string;
  confirmText?: string;
  cancelText?: string;
  danger?: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (!open) return;
      if (e.key === "Escape") onCancel();
      if (e.key === "Enter") onConfirm();
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onCancel, onConfirm]);

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-[90] grid place-items-center bg-sp-text/30 p-4">
      <div className="sp-card w-full max-w-md">
        <div>
          <div className="text-sm font-semibold text-sp-text">{title}</div>
          {message ? <div className="mt-1 text-xs text-sp-secondary">{message}</div> : null}
        </div>
        <div className="mt-6 flex items-center justify-end gap-2">
          <button
            onClick={onCancel}
            className="sp-btn sp-btn-ghost"
          >
            {cancelText}
          </button>
          <button
            onClick={onConfirm}
            className={
              "sp-btn " +
              (danger ? "sp-btn-danger" : "sp-btn-primary")
            }
          >
            {confirmText}
          </button>
        </div>
      </div>
    </div>
  );
}
