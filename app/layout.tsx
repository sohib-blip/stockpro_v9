import "./globals.css";
import type { Metadata } from "next";
import { IBM_Plex_Sans } from "next/font/google";
import AutoLogout from "@/components/AutoLogout";

const ibmPlexSans = IBM_Plex_Sans({
  subsets: ["latin"],
  weight: ["400", "500", "600", "700"],
  variable: "--font-ibm-plex-sans",
  display: "swap",
});

export const metadata: Metadata = {
  title: "StockPro",
  description: "Warehouse operations console",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en" className={ibmPlexSans.variable}>
      <body className="bg-sp-bg text-sp-text min-h-screen">
        <AutoLogout />
        {children}
      </body>
    </html>
  );
}
