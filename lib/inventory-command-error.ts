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
