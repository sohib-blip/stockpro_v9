type RpcErrorLike = {
  code?: string | null;
  message?: string | null;
};

export function inventoryCommandErrorStatus(error: RpcErrorLike) {
  if (error.code === "23505" || error.code === "40001") return 409;
  if (
    error.code === "22023" ||
    error.code === "P0002" ||
    error.code === "23514"
  ) {
    return 400;
  }
  return 500;
}

export function inventoryCommandErrorMessage(
  error: RpcErrorLike,
  fallback: string
) {
  const message = String(error.message || "");

  const insufficient = message.match(
    /ACCESSORY_STOCK_INSUFFICIENT:(.*):(\d+):(\d+)/i
  );
  if (insufficient) {
    return `Not enough stock for ${insufficient[1]}. Stock: ${insufficient[2]}, needed: ${insufficient[3]}`;
  }

  if (message.includes("ACCESSORY_BINS_NOT_FOUND")) {
    return "One or more accessories are unavailable. Preview again.";
  }
  if (message.includes("ACCESSORY_STOCK_CHANGED")) {
    return "Accessory stock changed. Preview and try again.";
  }
  if (message.includes("TRANSFER_BOXES_NOT_FOUND")) {
    return "One or more boxes were not found in the selected device.";
  }
  if (message.includes("TRANSFER_ALREADY_ON_FLOOR")) {
    return "One or more boxes are already on the destination floor.";
  }
  if (message.includes("TRANSFER_EMPTY_BOX")) {
    return "An empty box cannot be transferred.";
  }
  if (message.includes("OUTBOUND_IMEIS_NOT_FOUND")) {
    return "One or more IMEIs could not be found. Preview again.";
  }
  if (message.includes("OUTBOUND_IMEI_NOT_IN_STOCK")) {
    return "One or more IMEIs are no longer in stock. Preview again.";
  }
  if (message.includes("SUPPLY_TERMINAL_LOCKED")) {
    return "Imported and failed supply orders are locked and cannot be changed or deleted.";
  }
  if (message.includes("SUPPLY_NOT_FOUND")) {
    return "Supply order not found.";
  }
  if (message.includes("SUPPLY_STATUS_TRANSITION_INVALID")) {
    return "This supply status transition is not allowed.";
  }
  if (message.includes("PACKAGING_NOT_FOUND")) {
    return "Packaging format not found. Refresh and try again.";
  }
  if (message.includes("PACKAGING_INACTIVE")) {
    return "This packaging format is inactive and its stock cannot be changed.";
  }
  if (message.includes("PACKAGING_NO_STOCK_CHANGE")) {
    return "The requested count is already the current packaging stock.";
  }
  const dispatchPackagingInsufficient = message.match(
    /DISPATCH_PACKAGING_INSUFFICIENT:(.*):(\d+):(\d+)/i
  );
  if (dispatchPackagingInsufficient) {
    return `Not enough ${dispatchPackagingInsufficient[1]} packaging. Available: ${dispatchPackagingInsufficient[2]}, required: ${dispatchPackagingInsufficient[3]}.`;
  }
  if (message.includes("DISPATCH_SOURCE_ALREADY_CONFIRMED")) {
    return "This daily workbook has already been confirmed. No packaging was deducted again.";
  }
  if (message.includes("DISPATCH_ORDERS_ALREADY_CONFIRMED")) {
    return "One or more Order IDs were already confirmed in another dispatch batch.";
  }
  if (message.includes("DISPATCH_BATCH_ALREADY_UNDONE")) {
    return "This dispatch batch has already been undone.";
  }
  if (message.includes("DISPATCH_BATCH_NOT_FOUND")) {
    return "Dispatch batch not found.";
  }
  const packagingBelowReserved = message.match(
    /PACKAGING_STOCK_BELOW_RESERVED:(.*):(-?\d+):(\d+)/i
  );
  if (packagingBelowReserved) {
    return `Stock cannot be reduced to ${packagingBelowReserved[2]} for ${packagingBelowReserved[1]} because ${packagingBelowReserved[3]} units are reserved.`;
  }
  if (
    message.includes("OPERATION_ID_CONFLICT") ||
    message.includes("OPERATION_RESULT_UNAVAILABLE") ||
    error.code === "40001"
  ) {
    return "Inventory changed while processing. Preview and try again.";
  }

  return inventoryCommandErrorStatus(error) >= 500
    ? fallback
    : "Invalid inventory command.";
}
