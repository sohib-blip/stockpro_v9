// @vitest-environment jsdom
import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import ConfirmDialog from "../../components/ConfirmDialog";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

type Props = Partial<React.ComponentProps<typeof ConfirmDialog>>;

let host: HTMLDivElement;
let root: Root;
let trigger: HTMLButtonElement;

function render(props: Props = {}) {
  act(() => {
    root.render(
      <ConfirmDialog
        open
        title="Delete Supply Order?"
        confirmText="Delete"
        cancelText="Cancel"
        onConfirm={() => {}}
        onCancel={() => {}}
        {...props}
      />
    );
  });
}

function button(label: string) {
  const found = Array.from(document.querySelectorAll("button")).find(
    (b) => b.textContent === label
  );
  if (!found) throw new Error(`button ${label} not found`);
  return found as HTMLButtonElement;
}

function press(target: Element, key: string, shiftKey = false) {
  const event = new KeyboardEvent("keydown", { key, shiftKey, bubbles: true, cancelable: true });
  act(() => {
    target.dispatchEvent(event);
  });
  return event;
}

beforeEach(() => {
  trigger = document.createElement("button");
  trigger.textContent = "Open";
  document.body.appendChild(trigger);
  trigger.focus();
  host = document.createElement("div");
  document.body.appendChild(host);
  root = createRoot(host);
});

afterEach(() => {
  act(() => root.unmount());
  document.body.innerHTML = "";
});

describe("ConfirmDialog", () => {
  it("does not confirm when Enter is pressed on Cancel", () => {
    const onConfirm = vi.fn();
    render({ onConfirm });
    const cancel = button("Cancel");
    act(() => cancel.focus());
    press(cancel, "Enter");
    expect(onConfirm).not.toHaveBeenCalled();
  });

  it("focuses the confirm button on open and keeps the user's focus across re-renders", () => {
    render({ onConfirm: () => {}, onCancel: () => {} });
    expect(document.activeElement).toBe(button("Delete"));
    act(() => button("Cancel").focus());
    // Callers pass new inline callbacks on every render.
    render({ onConfirm: () => {}, onCancel: () => {} });
    expect(document.activeElement).toBe(button("Cancel"));
  });

  it("keeps Tab and Shift+Tab inside the dialog", () => {
    render();
    const cancel = button("Cancel");
    const confirm = button("Delete");
    act(() => confirm.focus());
    expect(press(confirm, "Tab").defaultPrevented).toBe(true);
    expect(document.activeElement).toBe(cancel);
    expect(press(cancel, "Tab", true).defaultPrevented).toBe(true);
    expect(document.activeElement).toBe(confirm);
    // Focus outside the dialog is brought back in.
    act(() => trigger.focus());
    expect(document.activeElement).toBe(cancel);
  });

  it("gives the focus back to the previous element when it closes", () => {
    render();
    expect(document.activeElement).not.toBe(trigger);
    render({ open: false });
    expect(document.activeElement).toBe(trigger);
  });

  it("calls onCancel on Escape", () => {
    const onCancel = vi.fn();
    render({ onCancel });
    press(button("Delete"), "Escape");
    expect(onCancel).toHaveBeenCalledTimes(1);
  });

  it("confirms only once on a double click, and again after reopening", () => {
    const onConfirm = vi.fn();
    render({ onConfirm });
    const confirm = button("Delete");
    act(() => {
      confirm.click();
      confirm.click();
    });
    expect(onConfirm).toHaveBeenCalledTimes(1);
    render({ onConfirm, open: false });
    render({ onConfirm, open: true });
    act(() => button("Delete").click());
    expect(onConfirm).toHaveBeenCalledTimes(2);
  });

  it("disables confirmation while busy and allows a retry once busy ends", () => {
    const onConfirm = vi.fn();
    render({ onConfirm });
    act(() => button("Delete").click());
    render({ onConfirm, busy: true });
    expect(button("Delete").disabled).toBe(true);
    expect(button("Cancel").disabled).toBe(false);
    act(() => button("Delete").click());
    expect(onConfirm).toHaveBeenCalledTimes(1);
    // The action failed and the dialog stayed open: the user can try again.
    render({ onConfirm, busy: false });
    act(() => button("Delete").click());
    expect(onConfirm).toHaveBeenCalledTimes(2);
  });
});
