export type AuthCallbackSession = {
  access_token: string;
  refresh_token: string;
};

export function parseAuthCallbackSession(
  hash: string
): AuthCallbackSession | null {
  const params = new URLSearchParams(hash.startsWith("#") ? hash.slice(1) : hash);
  const accessToken = params.get("access_token");
  const refreshToken = params.get("refresh_token");

  if (!accessToken || !refreshToken) {
    return null;
  }

  return {
    access_token: accessToken,
    refresh_token: refreshToken,
  };
}
