import AppShell from "@/components/AppShell";
import RouteGuard from "@/components/RouteGuard";

export default function AppLayout({ children }: { children: React.ReactNode }) {
  return (
    <AppShell>
      <RouteGuard>

        <main className="w-full flex justify-center">
          <div className="w-full max-w-7xl px-6 py-6">
            {children}
          </div>
        </main>

      </RouteGuard>
    </AppShell>
  );
}