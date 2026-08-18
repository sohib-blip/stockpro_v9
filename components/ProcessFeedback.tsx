"use client";

import type { ReactNode } from "react";

export type ProcessFeedbackKind = "success" | "error" | "info";

export type ProcessFeedbackValue = {
  kind: ProcessFeedbackKind;
  title: string;
  message?: ReactNode;
};

export default function ProcessFeedback({
  kind,
  title,
  message,
  onDismiss,
  children,
}: ProcessFeedbackValue & {
  onDismiss?: () => void;
  children?: ReactNode;
}) {
  const symbol = kind === "success" ? "✓" : kind === "error" ? "!" : "i";

  return (
    <div
      className={`process-feedback is-${kind}`}
      role={kind === "error" ? "alert" : "status"}
      aria-live={kind === "error" ? "assertive" : "polite"}
      aria-atomic="true"
    >
      <span className="process-feedback-icon" aria-hidden="true">
        {symbol}
      </span>
      <div className="process-feedback-copy">
        <strong>{title}</strong>
        {message ? <div>{message}</div> : null}
      </div>
      {children ? <div className="process-feedback-actions">{children}</div> : null}
      {onDismiss ? (
        <button
          type="button"
          className="process-feedback-dismiss"
          onClick={onDismiss}
          aria-label="Dismiss notification"
          title="Dismiss notification"
        >
          ×
        </button>
      ) : null}
    </div>
  );
}
