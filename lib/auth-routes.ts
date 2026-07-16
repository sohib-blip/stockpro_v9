const AUTHENTICATION_ROUTES = new Set([
  "/login",
  "/set-password",
  "/reset-password",
]);

export function isAuthenticationRoute(pathname: string) {
  return AUTHENTICATION_ROUTES.has(pathname);
}
