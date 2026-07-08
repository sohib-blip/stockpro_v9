import AppShell from "@/components/AppShell";
import RouteGuard from "@/components/RouteGuard";

export default function AppLayout({ children }: { children: React.ReactNode }) {
  return (
    <AppShell>
      <RouteGuard>

        <main className="w-full">
  <div className="w-full px-3 py-6">
    {children}
  </div>
</main>

      </RouteGuard>
    </AppShell>
  );
}