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
  icons: {
    icon: [{ url: "/stockpro-icon-v2.png", type: "image/png", sizes: "512x512" }],
    apple: [
      {
        url: "/stockpro-apple-touch-v2.png",
        sizes: "180x180",
        type: "image/png",
      },
    ],
    shortcut: "/stockpro-favicon-v2.ico",
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
