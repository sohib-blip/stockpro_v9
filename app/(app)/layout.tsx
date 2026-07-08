import AppShell from "@/components/AppShell";
import RouteGuard from "@/components/RouteGuard";

export default function AppLayout({ children }: { children: React.ReactNode }) {
  return (
    <AppShell>
      <RouteGuard>

        <main className="flex-1 overflow-auto">
  <div className="w-full px-8 py-6">
    {children}
  </div>
</main>

      </RouteGuard>
    </AppShell>
  );
}