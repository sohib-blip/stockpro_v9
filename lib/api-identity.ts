export type ApiIdentity = {
  userId: string;
  email: string;
  role: string;
};

export function getApiIdentity(req: Request): ApiIdentity {
  const userId = req.headers.get("x-stockpro-user-id")?.trim() ?? "";
  const email = req.headers.get("x-stockpro-user-email")?.trim() ?? "";
  const role = req.headers.get("x-stockpro-user-role")?.trim() ?? "";

  if (!userId || !email) {
    throw new Error("Authenticated API identity is missing");
  }

  return { userId, email, role };
}

export function resolveApiUserEmail(
  req: Request,
  requestedEmail?: string | null
) {
  const identity = getApiIdentity(req);

  if (identity.role === "admin" && requestedEmail?.trim()) {
    return requestedEmail.trim();
  }

  return identity.email;
}
