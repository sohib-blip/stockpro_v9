"use client";

import { usePathname } from "next/navigation";
import { useEffect } from "react";

const ICON_VERSION = "4";

function replaceIconLink(
  rel: string,
  href: string,
  options: { sizes?: string; type?: string; color?: string } = {}
) {
  document.head.querySelectorAll(`link[rel="${rel}"]`).forEach((link) => {
    link.remove();
  });

  const link = document.createElement("link");
  link.rel = rel;
  link.href = `${href}?v=${ICON_VERSION}`;
  if (options.sizes) link.sizes = options.sizes;
  if (options.type) link.type = options.type;
  if (options.color) link.setAttribute("color", options.color);
  document.head.appendChild(link);
}

function applyStockProIcons() {
  replaceIconLink("shortcut icon", "/favicon.ico", {
    type: "image/x-icon",
  });
  replaceIconLink("icon", "/stockpro-icon-v2.png", {
    sizes: "512x512",
    type: "image/png",
  });
  replaceIconLink("apple-touch-icon", "/apple-touch-icon.png", {
    sizes: "180x180",
    type: "image/png",
  });
  replaceIconLink("mask-icon", "/safari-pinned-tab.svg", {
    color: "#155eef",
  });
}

export default function BrowserIconSync() {
  const pathname = usePathname();

  useEffect(() => {
    applyStockProIcons();

    const handlePageShow = () => applyStockProIcons();
    const handleFocus = () => applyStockProIcons();
    const handleVisibilityChange = () => {
      if (document.visibilityState === "visible") applyStockProIcons();
    };

    window.addEventListener("pageshow", handlePageShow);
    window.addEventListener("focus", handleFocus);
    document.addEventListener("visibilitychange", handleVisibilityChange);

    return () => {
      window.removeEventListener("pageshow", handlePageShow);
      window.removeEventListener("focus", handleFocus);
      document.removeEventListener("visibilitychange", handleVisibilityChange);
    };
  }, [pathname]);

  return null;
}
