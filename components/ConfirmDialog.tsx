"use client";

import React, { useEffect, useId, useRef } from "react";

const FOCUSABLE =
  'button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

/**
 * Modal confirmation for irreversible actions.
 *
 * Enter is left to the browser: it activates the focused button only, so
 * Enter on Cancel cancels. Focus stays inside the dialog while it is open and
 * goes back to where it was when it closes. A confirmation is accepted once:
 * further clicks or Enter presses are ignored until the dialog closes, or
 * until `busy` goes from true back to false (e.g. after an error, to retry).
 */
export default function ConfirmDialog({
  open,
  title,
  message,
  confirmText = "Confirm",
  cancelText = "Cancel",
  danger,
  busy = false,
  onConfirm,
  onCancel,
}: {
  open: boolean;
  title: string;
  message?: string;
  confirmText?: string;
  cancelText?: string;
  danger?: boolean;
  /** True while the confirmed action runs and the dialog stays open. */
  busy?: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  const titleId = useId();
  const messageId = useId();
  const dialogRef = useRef<HTMLDivElement>(null);
  const confirmRef = useRef<HTMLButtonElement>(null);
  const confirmedRef = useRef(false);

  // Callers pass inline functions; keep the latest ones without re-running
  // the open/close effect (which would move the focus on every render).
  const onCancelRef = useRef(onCancel);
  const busyRef = useRef(busy);
  useEffect(() => {
    onCancelRef.current = onCancel;
    busyRef.current = busy;
  });

  // A new opening starts unlocked.
  useEffect(() => {
    if (!open) confirmedRef.current = false;
  }, [open]);

  // The action finished but the dialog is still open: allow a retry.
  const wasBusy = useRef(busy);
  useEffect(() => {
    if (wasBusy.current && !busy) {
      confirmedRef.current = false;
    }
    wasBusy.current = busy;
  }, [busy]);

  useEffect(() => {
    if (!open) return;
    const previousFocus = document.activeElement as HTMLElement | null;
    confirmRef.current?.focus();

    function focusables() {
      return Array.from(
        dialogRef.current?.querySelectorAll<HTMLElement>(FOCUSABLE) ?? []
      );
    }

    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") {
        e.preventDefault();
        onCancelRef.current();
        return;
      }
      if (e.key !== "Tab") return;
      const items = focusables();
      if (items.length === 0) {
        e.preventDefault();
        return;
      }
      const first = items[0];
      const last = items[items.length - 1];
      const active = document.activeElement as HTMLElement | null;
      const inside = Boolean(active && dialogRef.current?.contains(active));
      if (e.shiftKey && (!inside || active === first)) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && (!inside || active === last)) {
        e.preventDefault();
        first.focus();
      }
    }

    // Focus moved outside (e.g. a click on the backdrop): bring it back.
    function onFocusIn(e: FocusEvent) {
      const target = e.target as Node | null;
      if (target && dialogRef.current && !dialogRef.current.contains(target)) {
        (focusables()[0] ?? dialogRef.current).focus();
      }
    }

    window.addEventListener("keydown", onKey);
    document.addEventListener("focusin", onFocusIn);
    return () => {
      window.removeEventListener("keydown", onKey);
      document.removeEventListener("focusin", onFocusIn);
      if (previousFocus?.isConnected) previousFocus.focus();
    };
  }, [open]);

  if (!open) return null;

  function handleConfirm() {
    if (confirmedRef.current || busyRef.current) return;
    confirmedRef.current = true;
    onConfirm();
  }

  return (
    <div
      className="fixed inset-0 z-[90] grid place-items-center bg-black/60 p-4"
      onMouseDown={(e) => {
        // Clicking the backdrop must not take the focus out of the dialog.
        if (e.target === e.currentTarget) e.preventDefault();
      }}
    >
      <div
        ref={dialogRef}
        tabIndex={-1}
        className="w-full max-w-md rounded-2xl border border-slate-800 bg-slate-950 shadow-xl outline-none"
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        aria-describedby={message ? messageId : undefined}
        aria-busy={busy || undefined}
      >
        <div className="p-4 border-b border-slate-800">
          <div id={titleId} className="text-sm font-semibold text-slate-100">{title}</div>
          {message ? <div id={messageId} className="mt-1 whitespace-pre-line text-xs text-slate-300">{message}</div> : null}
        </div>
        <div className="p-4 flex items-center justify-end gap-2">
          <button
            type="button"
            onClick={() => onCancelRef.current()}
            className="rounded-xl border border-slate-800 bg-slate-900 px-4 py-2 text-sm font-semibold hover:bg-slate-800"
          >
            {cancelText}
          </button>
          <button
            type="button"
            ref={confirmRef}
            onClick={handleConfirm}
            disabled={busy}
            className={
              "rounded-xl px-4 py-2 text-sm font-semibold text-white disabled:cursor-not-allowed disabled:opacity-60 " +
              (danger ? "bg-red-600 hover:bg-red-700" : "bg-indigo-600 hover:bg-indigo-700")
            }
          >
            {confirmText}
          </button>
        </div>
      </div>
    </div>
  );
}
