import "./globals.css";
import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "StockPro",
  description: "Inventory management console",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en">
      <body className="bg-slate-950 text-slate-100 min-h-screen">
        {children}
      </body>
    </html>
  );
}