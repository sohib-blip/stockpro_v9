const SESSION_ID_PATTERN = /^[A-Za-z0-9_-]{1,128}$/;

export function sessionIdFromAccessToken(accessToken: string) {
  const parts = accessToken.split(".");
  if (parts.length !== 3) return null;

  try {
    const payload = JSON.parse(
      Buffer.from(parts[1], "base64url").toString("utf8")
    ) as { session_id?: unknown };
    const sessionId = payload.session_id;

    return typeof sessionId === "string" &&
      SESSION_ID_PATTERN.test(sessionId)
      ? sessionId
      : null;
  } catch {
    return null;
  }
}
