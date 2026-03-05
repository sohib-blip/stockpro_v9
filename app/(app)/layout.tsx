import AppShell from "@/components/AppShell";
import RouteGuard from "@/components/RouteGuard";

export default function AppLayout({ children }: { children: React.ReactNode }) {
  return (
    <AppShell>
      <RouteGuard>
        <div className="flex justify-center w-full">
          <div className="w-full max-w-7xl mx-auto px-6 py-6">
            {children}
          </div>
        </div>
      </RouteGuard>
    </AppShell>
  );
}