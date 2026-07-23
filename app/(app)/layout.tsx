import AppShell from "@/components/AppShell";
import RouteGuard from "@/components/RouteGuard";
import AccessProvider from "@/components/AccessProvider";

export default function AppLayout({ children }: { children: React.ReactNode }) {
  return (
    <AccessProvider>
      <AppShell>
        <RouteGuard>{children}</RouteGuard>
      </AppShell>
    </AccessProvider>
  );
}
