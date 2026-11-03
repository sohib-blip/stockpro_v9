"use client";

import { Fragment, useEffect, useMemo, useRef, useState } from "react";
import { apiFetch, downloadApiFile } from "@/lib/apiFetch";
import ConfirmDialog from "@/components/ConfirmDialog";
import DispatchAssignments, {
  changeDispatchPlanLock,
  DispatchPlanBanner,
  type DispatchPlanState,
} from "@/components/DispatchAssignments";
import DispatchItemDialog from "@/components/DispatchItemDialog";
import DispatchManualOutbound from "@/components/DispatchManualOutbound";
import DispatchPickingSheet from "@/components/DispatchPickingSheet";
import {
  dispatchPackagingRuleExtras,
  type DispatchPackagingRule,
} from "@/lib/dispatch-packaging-rules";
import { buildPickingSheet } from "@/lib/dispatch-picking-sheet";
import {
  clearStoredDispatchPreview,
  dispatchPreviewExpiresAt,
  loadStoredDispatchPreview,
  saveStoredDispatchPreview,
} from "@/lib/dispatch-preview-store";
import { isPackagingContainer } from "@/lib/packaging";
import ProcessFeedback, {
  type ProcessFeedbackValue,
} from "@/components/ProcessFeedback";

type PackageUsage = {
  packagingTypeId: string;
  code: string;
  name: string;
  quantity: number;
  onHandStock: number;
  availableStock: number;
  stockAfter: number;
};

type DispatchItem = {
  name: string;
  sourceItem: string;
  quantity: number;
  workbookQuantity?: number;
  automaticQuantity?: number;
  unitVolumeCm3: number;
  totalVolumeCm3: number;
};

type DispatchOrder = {
  orderId: string;
  destinationCountry: string;
  companyName: string;
  lineCount: number;
  totalVolumeCm3: number;
  adjustedVolumeCm3: number;
  items: DispatchItem[];
  deviceCounts?: Record<string, number>;
  compositionKey?: string;
  eligiblePackagingTypeIds?: string[];
  packages: Array<{
    packagingTypeId: string;
    name: string;
    code: string;
    quantity: number;
    source?: "calculated" | "learned" | "manual";
    learningCount?: number;
  }>;
  // Sleeves and other packaging added by automatic packaging rules.
  extras?: Array<{
    packagingTypeId: string;
    name: string;
    code: string;
    quantity: number;
    source?: "rule";
  }>;
};

type PackagingOption = {
  id: string;
  code: string;
  name: string;
  category?: string;
  lengthCm: number;
  widthCm: number;
  heightCm: number;
  onHandStock: number;
  reservedStock: number;
  availableStock: number;
};

type PickingSummaryRow = {
  category: "device" | "accessory" | "packaging";
  name: string;
  requiredQuantity: number;
  availableStock: number | null;
  difference: number | null;
  status: "available" | "shortage" | "not_configured";
  orderIds: string[];
};

type Preview = {
  ok: boolean;
  preview_token?: string;
  vehicle_label_count?: number;
  source?: {
    filename: string;
    generated_at: string | null;
    parsed_sheets: string[];
  };
  plan?: {
    orders: DispatchOrder[];
    packageUsage: PackageUsage[];
    blockers: string[];
    totalPackages: number;
  };
  issues?: Array<{
    sheet: string;
    row: number;
    message: string;
    hardwareType?: string;
    deviceType?: string;
    suggestedName?: string | null;
  }>;
  packaging_options?: PackagingOption[];
  packaging_rules?: DispatchPackagingRule[];
  // Orders already deducted in an earlier dispatch: not deducted again, but
  // still on the picking sheet and the vehicle labels.
  carried_orders?: Array<DispatchOrder & { confirmedAt: string; confirmedIn: string }>;
  nothing_new?: boolean;
  picking_summary?: PickingSummaryRow[];
  cabinet_stock?: Record<string, number>;
  dispatch_plan?: { id: string; status: string; resumed: boolean } | null;
};

type HistoryRow = {
  id: string;
  source_filename: string;
  source_generated_at: string | null;
  status: "CONFIRMED" | "UNDONE";
  order_count: number;
  line_count: number;
  total_packages: number;
  package_usage: PackageUsage[];
  actor_email: string;
  confirmed_at: string;
  undone_at: string | null;
  undone_by_email: string | null;
};

type HistoryDetail = HistoryRow & { orders: DispatchOrder[] };

function formatNumber(value: number, digits = 0) {
  return new Intl.NumberFormat("en-GB", {
    maximumFractionDigits: digits,
  }).format(value);
}

function formatDate(value: string | null) {
  if (!value) return "—";
  return new Intl.DateTimeFormat("en-GB", {
    timeZone: "Europe/Brussels",
    dateStyle: "medium",
    timeStyle: "short",
  }).format(new Date(value));
}

function formatPackageDimensions(
  packaging: Pick<PackagingOption, "lengthCm" | "widthCm" | "heightCm">
) {
  return `${formatNumber(packaging.lengthCm, 2)} × ${formatNumber(
    packaging.widthCm,
    2
  )} × ${formatNumber(packaging.heightCm, 2)} cm`;
}

function csvCell(value: unknown) {
  const text = String(value ?? "");
  const protectedText = /^[=+\-@]/.test(text) ? `'${text}` : text;
  return `"${protectedText.replace(/"/g, '""')}"`;
}

function rebuildClientPlan(
  orders: DispatchOrder[],
  options: PackagingOption[],
  rules: DispatchPackagingRule[]
) {
  const optionsById = new Map(options.map((option) => [option.id, option]));
  const usageById = new Map<string, PackageUsage>();
  const blockers: string[] = [];

  function addUsage(option: PackagingOption, quantity: number) {
    const total = (usageById.get(option.id)?.quantity || 0) + quantity;
    usageById.set(option.id, {
      packagingTypeId: option.id,
      code: option.code,
      name: option.name,
      quantity: total,
      onHandStock: option.onHandStock,
      availableStock: option.availableStock,
      stockAfter: option.onHandStock - total,
    });
  }

  const plannedOrders = orders.map((order) => {
    const extras = dispatchPackagingRuleExtras(order, rules)
      .flatMap((extra) => {
        const option = optionsById.get(extra.packagingTypeId);
        if (!option) {
          const message = "An automatic packaging rule uses a packaging format that is inactive or missing.";
          if (!blockers.includes(message)) blockers.push(message);
          return [];
        }
        return [
          {
            packagingTypeId: option.id,
            code: option.code,
            name: option.name,
            quantity: extra.quantity,
            source: "rule" as const,
          },
        ];
      })
      .sort((a, b) => a.name.localeCompare(b.name));

    const chosen = order.packages.flatMap((allocation) => {
      const option = optionsById.get(allocation.packagingTypeId);
      return option ? [{ option, quantity: allocation.quantity }] : [];
    });
    if (chosen.length === 0 || chosen.length < order.packages.length) {
      blockers.push(`Order ${order.orderId}: select an available package.`);
    }
    for (const { option, quantity } of chosen) addUsage(option, quantity);
    for (const extra of extras) {
      addUsage(optionsById.get(extra.packagingTypeId)!, extra.quantity);
    }
    return { ...order, extras: extras.length > 0 ? extras : undefined };
  });

  const packageUsage = Array.from(usageById.values()).sort((a, b) =>
    a.name.localeCompare(b.name)
  );
  for (const usage of packageUsage) {
    if (usage.quantity > usage.availableStock) {
      blockers.push(
        `${usage.name}: ${usage.quantity} required, but only ${usage.availableStock} available.`
      );
    }
  }

  return {
    orders: plannedOrders,
    packageUsage,
    blockers,
    totalPackages: packageUsage.reduce(
      (total, usage) => total + usage.quantity,
      0
    ),
  };
}

function manualOrders(preview: Preview | null) {
  return (preview?.plan?.orders || []).filter((order) =>
    order.packages.some((allocation) => allocation.source === "manual")
  );
}

// Puts the packages chosen by hand back on the same orders after a new preview.
function withManualPackages(preview: Preview, manual: DispatchOrder[]): Preview {
  if (!preview.plan || manual.length === 0) return preview;
  const options = preview.packaging_options || [];
  const optionIds = new Set(options.map((option) => option.id));
  const packagesByOrder = new Map(manual.map((order) => [order.orderId, order.packages]));
  let changed = false;
  const orders = preview.plan.orders.map((order) => {
    const packages = packagesByOrder.get(order.orderId);
    if (!packages?.every((allocation) => optionIds.has(allocation.packagingTypeId))) {
      return order;
    }
    changed = true;
    return { ...order, packages };
  });
  if (!changed) return preview;
  const plan = rebuildClientPlan(orders, options, preview.packaging_rules || []);
  return { ...preview, ok: plan.blockers.length === 0 && !preview.nothing_new, plan };
}

export default function DispatchPlanningPage() {
  const [file, setFile] = useState<File | null>(null);
  const [fileInputKey, setFileInputKey] = useState(0);
  const [preview, setPreview] = useState<Preview | null>(null);
  const [history, setHistory] = useState<HistoryRow[]>([]);
  const [detail, setDetail] = useState<HistoryDetail | null>(null);
  const [feedback, setFeedback] = useState<ProcessFeedbackValue | null>(null);
  const [mode, setMode] = useState<"workbook" | "manual">("workbook");
  const [busy, setBusy] = useState(false);
  const [historyBusy, setHistoryBusy] = useState(false);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [clearAsk, setClearAsk] = useState(false);
  const [undoTarget, setUndoTarget] = useState<HistoryRow | null>(null);
  const [orderSearch, setOrderSearch] = useState("");
  const [pickingOpen, setPickingOpen] = useState(false);
  const [pickingCategory, setPickingCategory] =
    useState<PickingSummaryRow["category"]>("device");
  const [pickingSearch, setPickingSearch] = useState("");
  const [pickingAttentionOnly, setPickingAttentionOnly] = useState(false);
  const [pickingSheetOpen, setPickingSheetOpen] = useState(false);
  const [resolveIssue, setResolveIssue] = useState<{
    label: string;
    hardwareType?: string;
    deviceType?: string;
  } | null>(null);
  const [planState, setPlanState] = useState<DispatchPlanState | null>(null);
  const [replaceAsk, setReplaceAsk] = useState<{
    filename: string;
    assignments: number;
  } | null>(null);
  const operationId = useRef<string | null>(null);
  const restoreStarted = useRef(false);
  const [restoreChecked, setRestoreChecked] = useState(false);
  const [now, setNow] = useState(() => Date.now());
  // Another account is doing today's dispatch planning: no import, no confirm.
  const lockedByOther = Boolean(
    planState?.plan?.locking &&
      planState.me &&
      planState.plan.planner_id !== planState.me.id
  );
  const planningMine = Boolean(
    planState?.plan?.locking &&
      planState.me &&
      planState.plan.planner_id === planState.me.id
  );
  const assignedCount = planState?.assignments?.length || 0;
  const previewExpiresAt = useMemo(
    () => dispatchPreviewExpiresAt(preview?.preview_token),
    [preview?.preview_token]
  );
  // One minute of margin so a confirmation never reaches the server expired.
  const previewExpired = previewExpiresAt !== null && previewExpiresAt - 60_000 <= now;

  const previewTotals = useMemo(() => {
    const orders = preview?.plan?.orders || [];
    return {
      orders: orders.length,
      lines: orders.reduce((total, order) => total + order.lineCount, 0),
      automaticItems: orders.reduce(
        (total, order) =>
          total +
          order.items.reduce(
            (itemTotal, item) =>
              itemTotal + Number(item.automaticQuantity || 0),
            0
          ),
        0
      ),
      volume: orders.reduce((total, order) => total + order.totalVolumeCm3, 0),
    };
  }, [preview]);

  const filteredPreviewOrders = useMemo(() => {
    const orders = preview?.plan?.orders || [];
    const query = orderSearch.trim().toLocaleLowerCase();
    if (!query) return orders;
    return orders.filter((order) =>
      [
        order.orderId,
        order.destinationCountry,
        order.companyName,
        ...order.items.flatMap((item) => [item.name, item.sourceItem]),
        ...[...order.packages, ...(order.extras || [])].flatMap((packaging) => [
          packaging.name,
          packaging.code,
        ]),
      ].some((value) => String(value || "").toLocaleLowerCase().includes(query))
    );
  }, [orderSearch, preview]);

  const pickingRows = useMemo(() => {
    const baseRows = (preview?.picking_summary || []).filter(
      (row) => row.category !== "packaging"
    );
    const plan = preview?.plan;
    if (!plan) return baseRows;
    const packagingRows: PickingSummaryRow[] = plan.packageUsage.map(
      (usage) => {
        const difference = usage.availableStock - usage.quantity;
        return {
          category: "packaging",
          name: usage.name,
          requiredQuantity: usage.quantity,
          availableStock: usage.availableStock,
          difference,
          status: difference < 0 ? "shortage" : "available",
          orderIds: plan.orders
            .filter((order) =>
              [...order.packages, ...(order.extras || [])].some(
                (packaging) =>
                  packaging.packagingTypeId === usage.packagingTypeId
              )
            )
            .map((order) => order.orderId),
        };
      }
    );
    return [...baseRows, ...packagingRows];
  }, [preview]);
  const pickingSheet = useMemo(() => {
    if (!preview?.plan) return null;
    const warehouseStock = Object.fromEntries(
      (preview.picking_summary || [])
        .filter((row) => row.category === "device")
        .map((row) => [row.name, row.availableStock])
    );
    return buildPickingSheet(
      [
        ...preview.plan.orders,
        ...(preview.carried_orders || []).map((order) => ({ ...order, carried: true })),
      ],
      preview.cabinet_stock || {},
      warehouseStock
    );
  }, [preview]);
  const pickingAttentionCount = pickingRows.filter(
    (row) => row.status !== "available"
  ).length;
  const pickingCategoryTotals = useMemo(() => {
    return (["device", "accessory", "packaging"] as const).map(
      (category) => ({
        category,
        rows: pickingRows.filter((row) => row.category === category).length,
        required: pickingRows
          .filter((row) => row.category === category)
          .reduce((total, row) => total + row.requiredQuantity, 0),
      })
    );
  }, [pickingRows]);
  const filteredPickingRows = useMemo(() => {
    const query = pickingSearch.trim().toLocaleLowerCase();
    return pickingRows.filter(
      (row) =>
        row.category === pickingCategory &&
        (!pickingAttentionOnly || row.status !== "available") &&
        (!query ||
          [row.name, ...row.orderIds].some((value) =>
            value.toLocaleLowerCase().includes(query)
          ))
    );
  }, [pickingAttentionOnly, pickingCategory, pickingRows, pickingSearch]);

  // Daily workbook / Manual switch, shown at the top of the left card like
  // the Device and Accessory Outbound mode switches.
  const modeSwitch = (
    <div className="prototype-segmented-control dispatch-mode-switch">
      <button type="button" className={mode === "workbook" ? "is-active" : ""} onClick={() => setMode("workbook")}>Daily workbook</button>
      <button type="button" className={mode === "manual" ? "is-active" : ""} onClick={() => setMode("manual")}>Manual</button>
    </div>
  );

  async function loadHistory() {
    setHistoryBusy(true);
    try {
      const response = await apiFetch(
        `/api/dispatch-planning/history?t=${Date.now()}`,
        { cache: "no-store" }
      );
      const json = await response.json().catch(() => null);
      setHistory(response.ok && json?.ok ? json.rows || [] : []);
    } finally {
      setHistoryBusy(false);
    }
  }

  async function loadPlan() {
    const response = await apiFetch(
      `/api/dispatch-planning/plan?t=${Date.now()}`,
      { cache: "no-store" }
    ).catch(() => null);
    const json = await response?.json().catch(() => null);
    if (response?.ok && json?.ok) setPlanState(json);
  }

  useEffect(() => {
    loadHistory();
    loadPlan();
    // Keeps the planner banner and the assignments current on every account.
    const timer = window.setInterval(() => {
      if (document.visibilityState === "visible") void loadPlan();
    }, 30_000);
    return () => window.clearInterval(timer);
  }, []);

  // Keep the preview in this browser while today's planning is open, so a
  // menu change or a reload does not lose it.
  const myId = planState?.me?.id;
  useEffect(() => {
    const planId = preview?.dispatch_plan?.id;
    if (!preview?.plan || !planId || !myId || !file) return;
    void saveStoredDispatchPreview({
      planId,
      userId: myId,
      savedAt: Date.now(),
      fileName: file.name,
      file,
      preview,
    });
  }, [preview, file, myId]);

  // Show the kept preview again, like the assignments: only while that
  // planning is still open and ours.
  useEffect(() => {
    if (restoreStarted.current || !planState) return;
    restoreStarted.current = true;
    void (async () => {
      try {
        const stored = await loadStoredDispatchPreview<Preview>();
        if (!stored) return;
        const plan = planState.plan;
        const ours = Boolean(
          plan &&
            plan.id === stored.planId &&
            plan.status === "OPEN" &&
            plan.locking &&
            plan.planner_id === stored.userId &&
            planState.me?.id === stored.userId
        );
        if (!ours) {
          await clearStoredDispatchPreview();
          return;
        }
        setPreview((current) => current ?? stored.preview);
        setFile(
          (current) =>
            current ?? new File([stored.file], stored.fileName, { type: stored.file.type })
        );
        operationId.current ??= crypto.randomUUID();
      } finally {
        setRestoreChecked(true);
      }
    })();
  }, [planState]);

  useEffect(() => {
    if (previewExpiresAt === null) return;
    setNow(Date.now());
    const timer = window.setInterval(() => setNow(Date.now()), 30_000);
    return () => window.clearInterval(timer);
  }, [previewExpiresAt]);

  // keepManual: packages chosen by hand that survive a refreshed preview.
  async function previewWorkbook(replacePlan = false, keepManual: DispatchOrder[] = []) {
    if (!file) {
      setFeedback({
        kind: "error",
        title: "Workbook required",
        message: "Select the daily Kinesis vehicle order workbook first.",
      });
      return;
    }

    setBusy(true);
    setFeedback(null);
    setPreview(null);
    void clearStoredDispatchPreview();
    setOrderSearch("");
    setPickingOpen(false);
    setPickingSearch("");
    setPickingAttentionOnly(false);
    operationId.current = null;
    try {
      const form = new FormData();
      form.append("file", file);
      if (replacePlan) form.append("replace_plan", "1");
      const response = await apiFetch("/api/dispatch-planning/preview", {
        method: "POST",
        body: form,
      });
      const json = await response.json().catch(() => null);
      void loadPlan();
      if (json?.code === "DISPATCH_PLAN_REPLACE_REQUIRED") {
        setReplaceAsk({
          filename: json.source_filename || "another workbook",
          assignments: Number(json.assignment_count || 0),
        });
        return;
      }
      if (json?.code === "DISPATCH_PLAN_LOCKED") {
        setFeedback({
          kind: "error",
          title: "Dispatch planning in progress",
          message: json.error,
        });
        return;
      }
      if (json?.plan || json?.issues) {
        setPreview(json.plan ? withManualPackages(json, keepManual) : json);
      }
      if (json?.nothing_new) {
        setFeedback({
          kind: "info",
          title: "Nothing new to deduct",
          message: `All ${json.carried_orders?.length || 0} orders of this workbook were already deducted earlier. You can still print the picking sheet and the vehicle labels.`,
        });
        return;
      }
      if (!response.ok || !json?.ok) {
        setFeedback({
          kind: "error",
          title: "Dispatch preview blocked",
          message: json?.error || "The workbook could not be previewed.",
        });
        return;
      }

      operationId.current = crypto.randomUUID();
      setFeedback({
        kind: "info",
        title: "Preview ready — stock unchanged",
        message: `${json.plan.orders.length} orders were grouped by Order ID. ${json.plan.orders.reduce(
          (total: number, order: DispatchOrder) =>
            total +
            order.items.reduce(
              (itemTotal, item) =>
                itemTotal + Number(item.automaticQuantity || 0),
              0
            ),
          0
        )} required accessories were added to the volume calculation.${
          json.carried_orders?.length
            ? ` ${json.carried_orders.length} orders already deducted earlier are ignored.`
            : ""
        } Review the packaging deduction before confirming.`,
      });
    } finally {
      setBusy(false);
    }
  }

  async function confirmDispatch() {
    setConfirmOpen(false);
    if (!preview?.ok || !preview.preview_token) return;
    setBusy(true);
    setFeedback(null);
    try {
      const response = await apiFetch("/api/dispatch-planning/confirm", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          operation_id:
            operationId.current ||
            (operationId.current = crypto.randomUUID()),
          preview_token: preview.preview_token,
          // One selection per package line; an order can have several.
          selections: (preview.plan?.orders || []).flatMap((order) =>
            order.packages.map((allocation) => ({
              orderId: order.orderId,
              packagingTypeId: allocation.packagingTypeId,
              quantity: allocation.quantity,
              source: allocation.source,
              learningCount: allocation.learningCount,
            }))
          ),
        }),
      });
      const json = await response.json().catch(() => null);
      if (!response.ok || !json?.ok) {
        setFeedback({
          kind: "error",
          title: "Dispatch confirmation failed",
          message: json?.error || "Packaging stock was not changed.",
        });
        return;
      }

      setFeedback({
        kind: "success",
        title: "Daily dispatch confirmed",
        message: `${json.order_count} orders confirmed and ${json.total_packages} packages deducted.`,
      });
      setPreview(null);
      void clearStoredDispatchPreview();
      setFile(null);
      setFileInputKey((value) => value + 1);
      operationId.current = null;
      await Promise.all([loadHistory(), loadPlan()]);
    } finally {
      setBusy(false);
    }
  }

  function resetPreview() {
    setPreview(null);
    void clearStoredDispatchPreview();
    setOrderSearch("");
    setPickingOpen(false);
    setPickingSearch("");
    setPickingAttentionOnly(false);
    operationId.current = null;
  }

  // Clearing the preview of an open planning also ends that planning, so the
  // banner and the assignments do not stay behind and other accounts can work.
  async function clearPreviewAndEndPlanning() {
    setClearAsk(false);
    const planId = planState?.plan?.id;
    if (!planId) {
      resetPreview();
      return;
    }
    setBusy(true);
    setFeedback(null);
    try {
      const result = await changeDispatchPlanLock(planId, "release");
      if (!result.ok) {
        setFeedback({
          kind: "error",
          title: "Dispatch planning not changed",
          message: result.error || "The dispatch planning could not be ended.",
        });
        return;
      }
      resetPreview();
      setFeedback({
        kind: "info",
        title: "Preview cleared — planning ended",
        message: "Nothing was deducted. Other accounts can import a workbook again.",
      });
    } finally {
      await loadPlan();
      setBusy(false);
    }
  }

  function downloadPickingList() {
    if (pickingRows.length === 0) return;
    const lines = [
      [
        "Category",
        "Item",
        "Required today",
        "Available stock",
        "Difference",
        "Status",
        "Orders",
      ],
      ...pickingRows.map((row) => [
        row.category,
        row.name,
        row.requiredQuantity,
        row.availableStock ?? "Not linked",
        row.difference ?? "",
        row.status === "available"
          ? "Available"
          : row.status === "shortage"
            ? `Short by ${Math.abs(row.difference || 0)}`
            : "Stock not linked",
        row.orderIds.join(", "),
      ]),
    ];
    const csv = lines.map((line) => line.map(csvCell).join(",")).join("\r\n");
    const objectUrl = URL.createObjectURL(
      new Blob([`\uFEFF${csv}`], { type: "text/csv;charset=utf-8" })
    );
    const anchor = document.createElement("a");
    anchor.href = objectUrl;
    anchor.download = `dispatch-picking-list-${new Date()
      .toISOString()
      .slice(0, 10)}.csv`;
    document.body.appendChild(anchor);
    anchor.click();
    anchor.remove();
    URL.revokeObjectURL(objectUrl);
  }

  // Change the package lines of one order; the result is a manual choice
  // that StockPro learns once the dispatch is confirmed.
  function changeOrderPackages(
    orderId: string,
    change: (
      packages: DispatchOrder["packages"],
      optionById: Map<string, PackagingOption>
    ) => DispatchOrder["packages"]
  ) {
    setPreview((current) => {
      if (!current?.plan) return current;
      const options = current.packaging_options || [];
      const optionById = new Map(options.map((option) => [option.id, option]));
      const orders = current.plan.orders.map((order) =>
        order.orderId !== orderId
          ? order
          : {
              ...order,
              packages: change(order.packages, optionById).map((allocation) => ({
                ...allocation,
                source: "manual" as const,
                learningCount: undefined,
              })),
            }
      );
      const plan = rebuildClientPlan(orders, options, current.packaging_rules || []);
      return { ...current, ok: plan.blockers.length === 0, plan };
    });
    setFeedback({
      kind: "info",
      title: "Packaging adjusted",
      message:
        "Confirm the dispatch after the order is physically packed. StockPro will remember this choice for the same order composition.",
    });
  }

  function packageLine(option: PackagingOption, quantity: number) {
    return {
      packagingTypeId: option.id,
      code: option.code,
      name: option.name,
      quantity: Math.max(1, Math.min(1_000_000, quantity)),
    };
  }

  function updateOrderPackaging(
    orderId: string,
    index: number,
    update: { packagingTypeId?: string; quantity?: number }
  ) {
    changeOrderPackages(orderId, (packages, optionById) => {
      const current = packages[index];
      const option = optionById.get(update.packagingTypeId || current?.packagingTypeId || "");
      if (!option) return packages;
      const line = packageLine(option, update.quantity ?? current?.quantity ?? 1);
      return index < packages.length
        ? packages.map((allocation, at) => (at === index ? line : allocation))
        : [...packages, line];
    });
  }

  function addOrderPackage(orderId: string) {
    changeOrderPackages(orderId, (packages, optionById) => {
      const last = packages[packages.length - 1];
      const option = last ? optionById.get(last.packagingTypeId) : undefined;
      return option ? [...packages, packageLine(option, 1)] : packages;
    });
  }

  function removeOrderPackage(orderId: string, index: number) {
    changeOrderPackages(orderId, (packages) =>
      packages.length > 1 ? packages.filter((_, at) => at !== index) : packages
    );
  }

  async function undoDispatch() {
    const batch = undoTarget;
    setUndoTarget(null);
    if (!batch) return;
    setBusy(true);
    setFeedback(null);
    try {
      const response = await apiFetch("/api/dispatch-planning/undo", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          operation_id: crypto.randomUUID(),
          batch_id: batch.id,
        }),
      });
      const json = await response.json().catch(() => null);
      if (!response.ok || !json?.ok) {
        setFeedback({
          kind: "error",
          title: "Dispatch undo failed",
          message: json?.error || "Packaging stock was not restored.",
        });
        return;
      }
      setDetail(null);
      setFeedback({
        kind: "success",
        title: "Dispatch batch undone",
        message: `${json.restored_packages} packages were restored to stock. The original history remains visible.`,
      });
      await loadHistory();
    } finally {
      setBusy(false);
    }
  }

  async function openDetail(id: string) {
    const response = await apiFetch(
      `/api/dispatch-planning/history?id=${encodeURIComponent(id)}&t=${Date.now()}`,
      { cache: "no-store" }
    );
    const json = await response.json().catch(() => null);
    if (response.ok && json?.ok) setDetail(json.row);
    else {
      setFeedback({
        kind: "error",
        title: "History detail unavailable",
        message: json?.error || "The dispatch batch could not be loaded.",
      });
    }
  }

  return (
    <div className="prototype-page dispatch-planning-page">
      <header className="prototype-page-header">
        <div>
          <h1>Dispatch Planning</h1>
          <p>
            Group daily vehicle orders, calculate volume and deduct the selected packaging only after confirmation.
          </p>
        </div>
      </header>

      {feedback ? (
        <ProcessFeedback {...feedback} onDismiss={() => setFeedback(null)} />
      ) : null}

      {mode === "manual" ? (
        <DispatchManualOutbound
          modeSwitch={modeSwitch}
          onFeedback={setFeedback}
          onConfirmed={() => void loadHistory()}
        />
      ) : (
        <>
        <DispatchPlanBanner
          state={planState}
          onReload={loadPlan}
          onFeedback={setFeedback}
          onEnded={resetPreview}
          previewMissing={restoreChecked && planningMine && !preview?.plan && !busy}
        />
        <div className="prototype-stepper" aria-label="Dispatch progress">
          <div className={`prototype-step ${preview ? "is-complete" : "is-active"}`}>
            <span>{preview ? "✓" : "1"}</span><strong>Upload</strong>
          </div>
          <i />
          <div className={`prototype-step ${preview?.plan ? (assignedCount > 0 ? "is-complete" : "is-active") : ""}`}>
            <span>{preview?.plan && assignedCount > 0 ? "✓" : "2"}</span><strong>Preview</strong>
          </div>
          <i />
          <div className={`prototype-step ${preview?.plan && assignedCount > 0 ? "is-active" : ""}`}>
            <span>3</span><strong>Assign</strong>
          </div>
          <i />
          <div className="prototype-step">
            <span>4</span><strong>Confirm</strong>
          </div>
        </div>

        <section className={`prototype-process-grid dispatch-process-grid ${preview?.plan ? "has-preview" : ""}`}>
          <div className="prototype-process-input-column prototype-input-card">
            {modeSwitch}
            <span className="prototype-eyebrow">Daily order workbook</span>
            <h2>Import today&apos;s orders</h2>
            <p className="dispatch-help-copy">
              All worksheets are inspected. Hardware Type supplies the box contents;
              Device Type identifies each real device and adds any missing items from
              its automatic accessory rules.
            </p>
            <label className="spreadsheet-file-input">
              Kinesis vehicle sheet (.xlsx)
              <input
                key={fileInputKey}
                type="file"
                accept=".xlsx,.xls"
                onChange={(event) => {
                  setFile(event.target.files?.[0] || null);
                  setPreview(null);
                  void clearStoredDispatchPreview();
                  setOrderSearch("");
                  setPickingOpen(false);
                  setPickingSearch("");
                  setPickingAttentionOnly(false);
                  operationId.current = null;
                }}
              />
            </label>
            <div className="dispatch-safety-note">
              <strong>Preview is read-only.</strong>
              <span>Packaging stock changes only when you confirm.</span>
            </div>
            <button
              type="button"
              className="prototype-button primary dispatch-full-button"
              onClick={() => void previewWorkbook()}
              disabled={busy || !file || lockedByOther}
            >
              {busy ? "Working…" : "Preview Packaging"}
            </button>
          </div>

          <div className="prototype-card dispatch-preview-card">
            {!preview?.plan ? (
              <div className="dispatch-empty-preview">
                <span aria-hidden="true">□</span>
                <strong>No preview yet</strong>
                <p>Select the daily workbook to see orders, volumes and packaging before any deduction.</p>
              </div>
            ) : (
              <>
                <div className="dispatch-preview-heading">
                  <div>
                    <span className="prototype-eyebrow">Read-only preview</span>
                    <h2>{preview.source?.filename}</h2>
                    <p>{preview.source?.generated_at || "Workbook generated date not provided"}</p>
                  </div>
                  <div className="dispatch-preview-kpis">
                    <div><span>Orders</span><strong>{previewTotals.orders}</strong></div>
                    <div><span>Lines</span><strong>{previewTotals.lines}</strong></div>
                    <div><span>Packages</span><strong>{preview.plan.totalPackages}</strong></div>
                    <div><span>Device labels</span><strong>{preview.vehicle_label_count || 0}</strong></div>
                  </div>
                </div>

                {preview.plan.blockers.length > 0 ? (
                  <details className="dispatch-blockers" role="alert">
                    <summary>
                      {preview.plan.blockers.length} packaging issue{preview.plan.blockers.length === 1 ? "" : "s"} block confirmation
                    </summary>
                    <div className="dispatch-blocker-list">
                      {preview.plan.blockers.map((blocker) => <div key={blocker}>{blocker}</div>)}
                    </div>
                  </details>
                ) : null}

                <div className="dispatch-orders-heading">
                  <div>
                    <h3>Orders</h3>
                    <p>
                      {filteredPreviewOrders.length === preview.plan.orders.length
                        ? `${preview.plan.orders.length} orders · ${previewTotals.lines} sheet lines · ${previewTotals.automaticItems} automatic items`
                        : `${filteredPreviewOrders.length} of ${preview.plan.orders.length} orders`}
                    </p>
                  </div>
                  <div className="dispatch-orders-tools">
                    <input
                      type="search"
                      aria-label="Search dispatch orders"
                      placeholder="Search order, customer, country or item…"
                      value={orderSearch}
                      onChange={(event) => setOrderSearch(event.target.value)}
                    />
                    <button
                      type="button"
                      className="prototype-button secondary"
                      onClick={() => setPickingSheetOpen(true)}
                      disabled={!pickingSheet}
                    >
                      Print Picking Sheet
                    </button>
                    <button
                      type="button"
                      className="prototype-button secondary dispatch-picking-button"
                      onClick={() => setPickingOpen(true)}
                      disabled={pickingRows.length === 0}
                    >
                      Picking Summary · {pickingRows.length}
                      {pickingAttentionCount > 0 ? (
                        <span>{pickingAttentionCount} attention</span>
                      ) : null}
                    </button>
                  </div>
                </div>

                {preview.carried_orders?.length ? (
                  <div className="dispatch-carried-orders">
                    <strong>{`${preview.carried_orders.length} orders already deducted earlier — not deducted again`}</strong>
                    <span>They stay on the picking sheet and the vehicle labels.</span>
                    <small>
                      {preview.carried_orders
                        .map((order) => `${order.orderId} (${formatDate(order.confirmedAt)})`)
                        .join(" · ")}
                    </small>
                  </div>
                ) : null}
                <div className="dispatch-orders-scroll">
                  <table>
                    <thead><tr><th>Order ID</th><th>Country</th><th>Customer</th><th>Items</th><th>Volume</th><th>Packaging — editable</th></tr></thead>
                    <tbody>
                      {filteredPreviewOrders.map((order) => {
                        const allocation = order.packages[0];
                        const eligibleIds = new Set(order.eligiblePackagingTypeIds || []);
                        const options = (preview.packaging_options || []).filter(
                          (option) => isPackagingContainer(option.category)
                        );
                        const lines = order.packages.length > 0 ? order.packages : [null];
                        return <tr key={order.orderId}>
                          <td><strong>{order.orderId}</strong></td>
                          <td>{order.destinationCountry || "—"}</td>
                          <td>{order.companyName || "—"}</td>
                          <td>
                            <div className="dispatch-order-items">
                              {order.items.map((item) => (
                                <span key={`${item.name}-${item.sourceItem}`}>
                                  <strong>{item.quantity} × {item.name}</strong>
                                  {Number(item.automaticQuantity || 0) > 0 ? (
                                    <small>
                                      {Number(item.workbookQuantity || 0) > 0
                                        ? `+${item.automaticQuantity} automatic`
                                        : "Automatic rule"}
                                    </small>
                                  ) : null}
                                </span>
                              ))}
                            </div>
                          </td>
                          <td>{formatNumber(order.totalVolumeCm3, 1)} cm³</td>
                          <td>
                            <div className="dispatch-packaging-control">
                              {lines.map((line, index) => {
                                const selectedOption = options.find(
                                  (option) => option.id === line?.packagingTypeId
                                );
                                const label = index === 0
                                  ? `Package for order ${order.orderId}`
                                  : `Package ${index + 1} for order ${order.orderId}`;
                                return (
                                  <Fragment key={index}>
                                    <label>
                                      <select
                                        aria-label={label}
                                        value={line?.packagingTypeId || ""}
                                        onChange={(event) =>
                                          updateOrderPackaging(order.orderId, index, {
                                            packagingTypeId: event.target.value,
                                          })
                                        }
                                      >
                                        {!line ? (
                                          <option value="" disabled>Select a package…</option>
                                        ) : null}
                                        {options.map((option) => (
                                          <option key={option.id} value={option.id}>
                                            {option.name} · {formatPackageDimensions(option)} · {option.availableStock} available · {eligibleIds.has(option.id)
                                              ? "calculated fit"
                                              : "manual override"}
                                          </option>
                                        ))}
                                      </select>
                                      {selectedOption ? (
                                        <small className="dispatch-package-dimensions">
                                          {selectedOption.code} · {formatPackageDimensions(selectedOption)}
                                        </small>
                                      ) : null}
                                    </label>
                                    <label className="dispatch-package-quantity">
                                      <span>Qty</span>
                                      <input
                                        aria-label={index === 0
                                          ? `Package quantity for order ${order.orderId}`
                                          : `Package ${index + 1} quantity for order ${order.orderId}`}
                                        type="number"
                                        min={1}
                                        max={1_000_000}
                                        value={line?.quantity ?? 1}
                                        disabled={!line}
                                        onChange={(event) =>
                                          updateOrderPackaging(order.orderId, index, {
                                            quantity: Number(event.target.value) || 1,
                                          })
                                        }
                                      />
                                    </label>
                                    {order.packages.length > 1 ? (
                                      <button
                                        type="button"
                                        className="dispatch-package-remove"
                                        aria-label={`Remove package ${index + 1} from order ${order.orderId}`}
                                        onClick={() => removeOrderPackage(order.orderId, index)}
                                      >
                                        ×
                                      </button>
                                    ) : <span />}
                                  </Fragment>
                                );
                              })}
                              <div className="dispatch-packaging-footer">
                                {allocation ? (
                                  <small className={`dispatch-learning-note is-${allocation.source || "calculated"}`}>
                                    {allocation.source === "learned"
                                      ? `Learned from ${allocation.learningCount || 1} confirmed choice${(allocation.learningCount || 1) === 1 ? "" : "s"}`
                                      : allocation.source === "manual"
                                        ? "Adjusted — learned after confirmation"
                                        : "Calculated suggestion"}
                                  </small>
                                ) : (
                                  <small className="dispatch-learning-note is-manual">
                                    Choose any active package to override the calculation.
                                  </small>
                                )}
                                <button
                                  type="button"
                                  className="dispatch-add-box"
                                  disabled={!allocation}
                                  onClick={() => addOrderPackage(order.orderId)}
                                >
                                  + Add box
                                </button>
                              </div>
                              {order.extras?.length ? (
                                <div className="dispatch-packaging-extras">
                                  <span>Added automatically</span>
                                  {order.extras.map((extra) => (
                                    <strong key={extra.packagingTypeId}>{`+ ${extra.quantity} × ${extra.name}`}</strong>
                                  ))}
                                </div>
                              ) : null}
                            </div>
                          </td>
                        </tr>;
                      })}
                      {filteredPreviewOrders.length === 0 ? (
                        <tr>
                          <td colSpan={6} className="dispatch-orders-empty">
                            No orders match this search.
                          </td>
                        </tr>
                      ) : null}
                    </tbody>
                  </table>
                </div>
              </>
            )}
          </div>
        </section>

        {preview?.issues?.length ? (
          <section className="prototype-card prototype-history-card">
            <h2>Rows requiring correction</h2>
            <p>Add the missing dimensions once: the workbook is checked again automatically and the item is remembered for the next days.</p>
            <div className="dispatch-orders-scroll is-issues">
              <table><thead><tr><th>Sheet</th><th>Row</th><th>Hardware Type</th><th>Device Type</th><th>Problem</th><th>Action</th></tr></thead>
                <tbody>{preview.issues.map((issue, index) => (
                  <tr key={`${issue.sheet}-${issue.row}-${index}`}><td>{issue.sheet}</td><td>{issue.row}</td><td>{issue.hardwareType || "—"}</td><td>{issue.deviceType || "—"}</td><td>{issue.message}</td><td>{issue.suggestedName ? (
                    <button
                      type="button"
                      className="prototype-button secondary"
                      disabled={busy}
                      onClick={() => setResolveIssue({ label: issue.suggestedName!, hardwareType: issue.hardwareType, deviceType: issue.deviceType })}
                    >
                      Add dimensions
                    </button>
                  ) : "—"}</td></tr>
                ))}</tbody>
              </table>
            </div>
          </section>
        ) : null}
        </>
      )}

      <DispatchAssignments state={planState} onReload={loadPlan} onFeedback={setFeedback} />

      {mode === "workbook" && preview?.plan ? (
        <section className="prototype-card dispatch-confirm-card">
          <div className="dispatch-card-heading">
            <div>
              <h2>Confirm the dispatch</h2>
              <p>
                Packaging stock changes only when you confirm. Confirming also ends today&apos;s planning; the assignments and Word labels stay available today.
              </p>
            </div>
          </div>
          <div className="dispatch-package-summary">
            <div className="dispatch-package-summary-title">
              <span>Packaging deduction</span>
              <strong>
                {preview.plan.totalPackages} packages · {preview.plan.packageUsage.length} format{preview.plan.packageUsage.length === 1 ? "" : "s"}
              </strong>
            </div>
            <div className="dispatch-package-summary-list">
              {preview.plan.packageUsage.map((usage) => {
                const packaging = preview.packaging_options?.find(
                  (option) => option.id === usage.packagingTypeId
                );
                return (
                  <div key={usage.packagingTypeId}>
                    <span>
                      <strong>{usage.quantity} × {usage.name}</strong>
                      <small>
                        {usage.code}
                        {packaging && isPackagingContainer(packaging.category)
                          ? ` · ${formatPackageDimensions(packaging)}`
                          : ""}
                      </small>
                    </span>
                    <span
                      className={usage.stockAfter < 0 ? "is-danger" : ""}
                    >
                      {usage.onHandStock} → {usage.stockAfter}
                    </span>
                  </div>
                );
              })}
            </div>
          </div>
          {previewExpired ? (
            <div className="dispatch-confirm-expired" role="status">
              <span>
                This preview is more than 1 hour old. Refresh it before confirming; your packaging choices are kept.
              </span>
              <button
                type="button"
                className="prototype-button secondary dispatch-small-button"
                disabled={busy || !file || lockedByOther}
                onClick={() => void previewWorkbook(false, manualOrders(preview))}
              >
                Refresh preview
              </button>
            </div>
          ) : null}
          {preview.plan.blockers.length > 0 ? (
            <p className="dispatch-confirm-blocked">
              Fix the packaging issues shown above the orders to confirm.
            </p>
          ) : null}
          <div className="prototype-preview-actions">
            <button
              type="button"
              className="prototype-button secondary"
              onClick={() => (planningMine ? setClearAsk(true) : resetPreview())}
              disabled={busy}
            >
              Clear Preview
            </button>
            <button
              type="button"
              className="prototype-button confirm"
              onClick={() => setConfirmOpen(true)}
              disabled={busy || !preview.ok || lockedByOther || previewExpired}
            >
              Confirm &amp; Deduct Packaging
            </button>
          </div>
        </section>
      ) : null}

      {pickingSheetOpen && pickingSheet && (
        <DispatchPickingSheet
          sheet={pickingSheet}
          sourceName={preview?.source?.filename || ""}
          onClose={() => setPickingSheetOpen(false)}
        />
      )}

      {resolveIssue && (
        <DispatchItemDialog
          label={resolveIssue.label}
          hardwareType={resolveIssue.hardwareType}
          deviceType={resolveIssue.deviceType}
          onClose={() => setResolveIssue(null)}
          onSaved={() => {
            setResolveIssue(null);
            void previewWorkbook(false, manualOrders(preview));
          }}
        />
      )}

      <section className="prototype-card prototype-history-card dispatch-history-card">
        <div className="dispatch-history-heading">
          <div><h2>Dispatch History</h2><p>Confirmed and undone packaging deductions remain auditable.</p></div>
          <button type="button" className="prototype-button secondary" onClick={loadHistory} disabled={historyBusy}>Refresh</button>
        </div>
        <div className="dispatch-history-scroll">
          <table>
            <thead><tr><th>Date</th><th>Workbook</th><th>Orders</th><th>Lines</th><th>Packages</th><th>User</th><th>Status</th><th>Actions</th></tr></thead>
            <tbody>
              {history.length === 0 ? <tr><td colSpan={8} className="returns-history-empty">{historyBusy ? "Loading history…" : "No dispatch batches yet."}</td></tr> : history.map((row) => (
                <tr key={row.id}>
                  <td>{formatDate(row.confirmed_at)}</td><td><strong>{row.source_filename}</strong></td><td>{row.order_count}</td><td>{row.line_count}</td><td>{row.total_packages}</td><td>{row.actor_email}</td>
                  <td><span className={`dispatch-status is-${row.status.toLowerCase()}`}>{row.status}</span></td>
                  <td><div className="dispatch-row-actions">
                    <button type="button" onClick={() => openDetail(row.id)}>View</button>
                    <button type="button" onClick={() => downloadApiFile(`/api/dispatch-planning/export?id=${row.id}`, "dispatch.xlsx")}>Download</button>
                    {row.status === "CONFIRMED" ? <button type="button" className="is-danger" onClick={() => setUndoTarget(row)}>Undo</button> : null}
                  </div></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      {pickingOpen && preview?.picking_summary ? (
        <div
          className="returns-history-dialog-backdrop dispatch-picking-backdrop"
          onMouseDown={(event) => {
            if (event.target === event.currentTarget) setPickingOpen(false);
          }}
        >
          <section
            className="returns-history-dialog dispatch-picking-dialog"
            role="dialog"
            aria-modal="true"
            aria-labelledby="dispatch-picking-title"
          >
            <div className="returns-history-dialog-header">
              <div>
                <span>Read-only daily overview</span>
                <h2 id="dispatch-picking-title">Daily Picking Summary</h2>
                <p>
                  Required physical contents across all previewed orders. No
                  inventory is changed here.
                </p>
              </div>
              <button
                type="button"
                onClick={() => setPickingOpen(false)}
                aria-label="Close picking summary"
              >
                ×
              </button>
            </div>

            <div className="dispatch-picking-summary-cards">
              {pickingCategoryTotals.map((total) => (
                <div key={total.category}>
                  <span>{total.category}</span>
                  <strong>{formatNumber(total.required)}</strong>
                  <small>
                    {total.rows} item{total.rows === 1 ? "" : "s"}
                  </small>
                </div>
              ))}
              <div className={pickingAttentionCount > 0 ? "is-danger" : ""}>
                <span>Attention needed</span>
                <strong>{pickingAttentionCount}</strong>
                <small>
                  {pickingAttentionCount > 0
                    ? "Short or not linked"
                    : "Everything available"}
                </small>
              </div>
            </div>

            <div className="dispatch-picking-tabs" role="tablist">
              {pickingCategoryTotals.map((total) => (
                <button
                  key={total.category}
                  type="button"
                  role="tab"
                  aria-selected={pickingCategory === total.category}
                  className={
                    pickingCategory === total.category ? "is-active" : ""
                  }
                  onClick={() => setPickingCategory(total.category)}
                >
                  {total.category === "device"
                    ? "Devices"
                    : total.category === "accessory"
                      ? "Accessories"
                      : "Packaging"}
                  <span>{total.rows}</span>
                </button>
              ))}
            </div>

            <div className="dispatch-picking-toolbar">
              <input
                type="search"
                aria-label="Search picking summary"
                placeholder="Search item or order…"
                value={pickingSearch}
                onChange={(event) => setPickingSearch(event.target.value)}
              />
              <label>
                <input
                  type="checkbox"
                  checked={pickingAttentionOnly}
                  onChange={(event) =>
                    setPickingAttentionOnly(event.target.checked)
                  }
                />
                Attention only
              </label>
              <button
                type="button"
                className="prototype-button secondary"
                onClick={downloadPickingList}
              >
                Export Picking List
              </button>
            </div>

            <div className="returns-history-dialog-table-scroll dispatch-picking-table-scroll">
              <table>
                <thead>
                  <tr>
                    <th>Item</th>
                    <th>Required today</th>
                    <th>In stock</th>
                    <th>Difference</th>
                    <th>Status</th>
                    <th>Orders</th>
                  </tr>
                </thead>
                <tbody>
                  {filteredPickingRows.map((row) => (
                    <tr key={`${row.category}-${row.name}`}>
                      <td>
                        <strong>{row.name}</strong>
                      </td>
                      <td>{formatNumber(row.requiredQuantity)}</td>
                      <td>
                        {row.availableStock === null
                          ? "Not linked"
                          : formatNumber(row.availableStock)}
                      </td>
                      <td
                        className={
                          row.difference !== null && row.difference < 0
                            ? "is-danger"
                            : ""
                        }
                      >
                        {row.difference === null
                          ? "—"
                          : `${row.difference >= 0 ? "+" : ""}${formatNumber(
                              row.difference
                            )}`}
                      </td>
                      <td>
                        <span
                          className={`dispatch-picking-status is-${row.status}`}
                        >
                          {row.status === "available"
                            ? "Available"
                            : row.status === "shortage"
                              ? `Short by ${formatNumber(
                                  Math.abs(row.difference || 0)
                                )}`
                              : "Stock not linked"}
                        </span>
                      </td>
                      <td>
                        <div className="dispatch-picking-orders">
                          {row.orderIds.map((orderId) => (
                            <button
                              key={orderId}
                              type="button"
                              onClick={() => {
                                setOrderSearch(orderId);
                                setPickingOpen(false);
                              }}
                            >
                              {orderId}
                            </button>
                          ))}
                        </div>
                      </td>
                    </tr>
                  ))}
                  {filteredPickingRows.length === 0 ? (
                    <tr>
                      <td colSpan={6} className="dispatch-orders-empty">
                        No items match these filters.
                      </td>
                    </tr>
                  ) : null}
                </tbody>
              </table>
            </div>
          </section>
        </div>
      ) : null}

      {detail ? (
        <div className="returns-history-dialog-backdrop" onMouseDown={(event) => { if (event.target === event.currentTarget) setDetail(null); }}>
          <div className="returns-history-dialog" role="dialog" aria-modal="true" aria-label={`Dispatch ${detail.source_filename}`}>
            <div className="returns-history-dialog-header"><div><span>Dispatch batch</span><h2>{detail.source_filename}</h2><p>{formatDate(detail.confirmed_at)} · {detail.actor_email}</p></div><button type="button" onClick={() => setDetail(null)} aria-label="Close">×</button></div>
            <div className="returns-history-dialog-summary"><div><span>Status</span><strong>{detail.status}</strong></div><div><span>Orders</span><strong>{detail.order_count}</strong></div><div><span>Lines</span><strong>{detail.line_count}</strong></div><div><span>Packages</span><strong>{detail.total_packages}</strong></div></div>
            <div className="returns-history-dialog-toolbar"><div><strong>Order and packaging detail</strong><span>Every item is linked to its recommended package.</span></div><button type="button" className="prototype-button secondary" onClick={() => downloadApiFile(`/api/dispatch-planning/export?id=${detail.id}`, "dispatch.xlsx")}>Download Excel</button></div>
            <div className="returns-history-dialog-table-scroll"><table><thead><tr><th>Order ID</th><th>Country</th><th>Customer</th><th>Items</th><th>Volume</th><th>Packaging</th></tr></thead><tbody>{(detail.orders || []).map((order) => <tr key={order.orderId}><td><strong>{order.orderId}</strong></td><td>{order.destinationCountry || "—"}</td><td>{order.companyName || "—"}</td><td>{order.items.map((item) => `${item.quantity} × ${item.name}`).join(", ")}</td><td>{formatNumber(order.totalVolumeCm3, 1)} cm³</td><td>{[...order.packages, ...(order.extras || [])].map((item) => `${item.quantity} × ${item.name}`).join(", ")}</td></tr>)}</tbody></table></div>
          </div>
        </div>
      ) : null}

      <ConfirmDialog open={confirmOpen} title="Confirm daily dispatch?" message={`This will deduct ${preview?.plan?.totalPackages || 0} packages for ${preview?.plan?.orders.length || 0} orders. The action stays available in history and can be undone.`} confirmText="Confirm & Deduct" onConfirm={confirmDispatch} onCancel={() => setConfirmOpen(false)} />
      <ConfirmDialog
        open={clearAsk}
        title="Clear the preview and end today's planning?"
        message="Nothing is deducted. The planner banner and the order assignment disappear, and other accounts can import a workbook again. Importing the same workbook again reopens it with its assignments."
        confirmText="End planning"
        onConfirm={() => void clearPreviewAndEndPlanning()}
        onCancel={() => setClearAsk(false)}
      />
      <ConfirmDialog
        open={Boolean(replaceAsk)}
        title="Replace today's planning?"
        message={replaceAsk ? `Today's planning was started with ${replaceAsk.filename}${replaceAsk.assignments ? ` and ${replaceAsk.assignments} assigned orders` : ""}. This workbook replaces it${replaceAsk.assignments ? " and the assignments are removed" : ""}.` : undefined}
        confirmText="Replace planning"
        danger={Boolean(replaceAsk?.assignments)}
        onConfirm={() => {
          setReplaceAsk(null);
          void previewWorkbook(true);
        }}
        onCancel={() => setReplaceAsk(null)}
      />
      <ConfirmDialog open={Boolean(undoTarget)} title="Undo this dispatch batch?" message={undoTarget ? `This restores ${undoTarget.total_packages} packages to stock. The batch stays in history as UNDONE.` : undefined} confirmText="Undo & Restore Stock" danger onConfirm={undoDispatch} onCancel={() => setUndoTarget(null)} />
    </div>
  );
}
