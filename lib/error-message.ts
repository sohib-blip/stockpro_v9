// Message of a thrown value: Supabase errors are plain objects, not Errors, and
// a catch clause receives `unknown`. Falls back when there is no message.
export function errorMessage(error: unknown, fallback: string) {
  const message =
    error && typeof error === "object" && "message" in error
      ? String((error as { message: unknown }).message || "")
      : "";
  return message || fallback;
}
