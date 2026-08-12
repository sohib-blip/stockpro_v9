import AppShell from "@/components/AppShell";
import RouteGuard from "@/components/RouteGuard";
import AccessProvider from "@/components/AccessProvider";
import type { Metadata } from "next";

export const metadata: Metadata = {
  icons: {
    icon: [
      { url: "/favicon.ico?v=4", type: "image/x-icon", sizes: "any" },
      {
        url: "/stockpro-icon-v2.png?v=4",
        type: "image/png",
        sizes: "512x512",
      },
    ],
    apple: [
      {
        url: "/apple-touch-icon.png?v=4",
        type: "image/png",
        sizes: "180x180",
      },
    ],
    shortcut: "/favicon.ico?v=4",
  },
};

export default function AppLayout({ children }: { children: React.ReactNode }) {
  return (
    <AccessProvider>
      <AppShell>
        <RouteGuard>{children}</RouteGuard>
      </AppShell>
    </AccessProvider>
  );
}
