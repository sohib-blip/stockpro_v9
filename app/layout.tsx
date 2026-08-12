import "./globals.css";
import type { Metadata } from "next";
import AutoLogout from "@/components/AutoLogout";
import ToastProvider from "@/components/ToastProvider";
import PreferencesProvider from "@/components/PreferencesProvider";
import EnvironmentBanner from "@/components/EnvironmentBanner";
import { AuthPreferenceControls } from "@/components/PreferenceControls";

export const metadata: Metadata = {
  title: "StockPro",
  description: "Inventory management console",
  manifest: "/site.webmanifest?v=3",
  icons: {
    icon: [
      { url: "/favicon.ico?v=3", type: "image/x-icon", sizes: "any" },
      { url: "/stockpro-icon-v2.png?v=3", type: "image/png", sizes: "512x512" },
    ],
    apple: [
      {
        url: "/apple-touch-icon.png?v=3",
        sizes: "180x180",
        type: "image/png",
      },
    ],
    shortcut: "/favicon.ico?v=3",
  },
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en" data-theme="light" suppressHydrationWarning>
      <head>
        <link
          rel="mask-icon"
          href="/safari-pinned-tab.svg?v=3"
          color="#155eef"
        />
        <meta name="theme-color" content="#071a3d" />
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="anonymous" />
        <link
          href="https://fonts.googleapis.com/css2?family=IBM+Plex+Sans:wght@400;500;600;700&display=swap"
          rel="stylesheet"
        />
        <script
          dangerouslySetInnerHTML={{
            __html:
              "try{var t=localStorage.getItem('stockpro-theme');if(t==='dark'||t==='light')document.documentElement.dataset.theme=t;var l=localStorage.getItem('stockpro-locale');if(l==='en'||l==='fr'||l==='nl'){document.documentElement.lang=l;document.documentElement.dataset.locale=l}}catch(e){}",
          }}
        />
      </head>
      <body>
        <PreferencesProvider>
          <EnvironmentBanner />
          <AuthPreferenceControls />
          <ToastProvider>
            <AutoLogout />
            {children}
          </ToastProvider>
        </PreferencesProvider>
      </body>
    </html>
  );
}
