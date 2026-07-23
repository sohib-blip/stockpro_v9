export function isCronRequestAuthorized(
  authorizationHeader: string | null,
  cronSecret: string | undefined
): boolean {
  if (!cronSecret?.trim()) return false;

  return authorizationHeader === `Bearer ${cronSecret}`;
}

export function areLowStockEmailsEnabled(
  emailFlag: string | undefined,
  vercelEnvironment: string | undefined
): boolean {
  if (emailFlag !== undefined) return emailFlag === "true";

  return vercelEnvironment === "production";
}
