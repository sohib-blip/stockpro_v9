"use client";

import {
  createContext,
  ReactNode,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { Locale, translateUiText } from "@/lib/i18n";

export type Theme = "light" | "dark";

type PreferencesContextValue = {
  theme: Theme;
  locale: Locale;
  setTheme: (theme: Theme) => void;
  toggleTheme: () => void;
  setLocale: (locale: Locale) => void;
  t: (source: string) => string;
};

const PreferencesContext = createContext<PreferencesContextValue | null>(null);

const TEXT_ATTRIBUTES = ["placeholder", "title", "aria-label"] as const;

function DomTranslator({ locale }: { locale: Locale }) {
  const originalText = useRef(new WeakMap<Text, string>());
  const renderedLocale = useRef<Locale>("en");
  const originalAttributes = useRef(
    new WeakMap<Element, Partial<Record<(typeof TEXT_ATTRIBUTES)[number], string>>>()
  );

  useEffect(() => {
    let comparisonLocale = renderedLocale.current;

    const translateTextNode = (node: Text) => {
      const current = node.nodeValue ?? "";
      const previousSource = originalText.current.get(node);
      const previousTranslation = previousSource
        ? translateUiText(comparisonLocale, previousSource)
        : null;

      if (!previousSource || current !== previousTranslation) {
        originalText.current.set(node, current);
      }

      const source = originalText.current.get(node) ?? current;
      const next = translateUiText(locale, source);
      if (node.nodeValue !== next) node.nodeValue = next;
    };

    const translateElement = (element: Element) => {
      const stored = originalAttributes.current.get(element) ?? {};

      for (const attribute of TEXT_ATTRIBUTES) {
        if (!element.hasAttribute(attribute)) continue;
        const current = element.getAttribute(attribute) ?? "";
        const previousSource = stored[attribute];
        const previousTranslation = previousSource
          ? translateUiText(comparisonLocale, previousSource)
          : null;

        if (!previousSource || current !== previousTranslation) {
          stored[attribute] = current;
        }

        const source = stored[attribute] ?? current;
        const next = translateUiText(locale, source);
        if (current !== next) element.setAttribute(attribute, next);
      }

      originalAttributes.current.set(element, stored);
    };

    const visit = (root: Node) => {
      if (root.nodeType === Node.TEXT_NODE) {
        translateTextNode(root as Text);
        return;
      }

      if (root.nodeType !== Node.ELEMENT_NODE && root.nodeType !== Node.DOCUMENT_NODE) {
        return;
      }

      if (root.nodeType === Node.ELEMENT_NODE) translateElement(root as Element);
      const walker = document.createTreeWalker(
        root,
        NodeFilter.SHOW_ELEMENT | NodeFilter.SHOW_TEXT
      );
      let current = walker.nextNode();
      while (current) {
        if (current.nodeType === Node.TEXT_NODE) translateTextNode(current as Text);
        else translateElement(current as Element);
        current = walker.nextNode();
      }
    };

    visit(document.body);
    renderedLocale.current = locale;
    comparisonLocale = locale;

    const observer = new MutationObserver((mutations) => {
      for (const mutation of mutations) {
        if (mutation.type === "characterData") visit(mutation.target);
        mutation.addedNodes.forEach(visit);
        if (mutation.type === "attributes") visit(mutation.target);
      }
    });

    observer.observe(document.body, {
      subtree: true,
      childList: true,
      characterData: true,
      attributes: true,
      attributeFilter: [...TEXT_ATTRIBUTES],
    });

    return () => observer.disconnect();
  }, [locale]);

  return null;
}

export default function PreferencesProvider({ children }: { children: ReactNode }) {
  const [theme, setThemeState] = useState<Theme>("light");
  const [locale, setLocaleState] = useState<Locale>("en");
  const [preferencesReady, setPreferencesReady] = useState(false);

  useEffect(() => {
    const storedTheme = window.localStorage.getItem("stockpro-theme");
    const storedLocale = window.localStorage.getItem("stockpro-locale");
    if (storedTheme === "dark" || storedTheme === "light") setThemeState(storedTheme);
    if (storedLocale === "en" || storedLocale === "fr" || storedLocale === "nl") {
      setLocaleState(storedLocale);
    }
    setPreferencesReady(true);
  }, []);

  useEffect(() => {
    if (!preferencesReady) return;
    document.documentElement.dataset.theme = theme;
    window.localStorage.setItem("stockpro-theme", theme);
  }, [preferencesReady, theme]);

  useEffect(() => {
    if (!preferencesReady) return;
    document.documentElement.lang = locale;
    document.documentElement.dataset.locale = locale;
    window.localStorage.setItem("stockpro-locale", locale);
  }, [locale, preferencesReady]);

  const setTheme = useCallback((next: Theme) => setThemeState(next), []);
  const toggleTheme = useCallback(
    () => setThemeState((current) => (current === "light" ? "dark" : "light")),
    []
  );
  const setLocale = useCallback((next: Locale) => setLocaleState(next), []);
  const t = useCallback((source: string) => translateUiText(locale, source), [locale]);

  const value = useMemo(
    () => ({ theme, locale, setTheme, toggleTheme, setLocale, t }),
    [locale, setLocale, setTheme, t, theme, toggleTheme]
  );

  return (
    <PreferencesContext.Provider value={value}>
      <DomTranslator locale={locale} />
      {children}
    </PreferencesContext.Provider>
  );
}

export function usePreferences() {
  const context = useContext(PreferencesContext);
  if (!context) {
    throw new Error("usePreferences must be used inside PreferencesProvider");
  }
  return context;
}
