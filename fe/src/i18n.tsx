import {
  createContext,
  useContext,
  useEffect,
  useMemo,
  useState,
  type PropsWithChildren,
} from "react";
import en from "./locales/en.json";
import vi from "./locales/vi.json";

export type Language = "vi" | "en";
export type TranslationKey = keyof typeof en;

type TranslateOptions = Record<string, string | number>;

interface I18nContextValue {
  language: Language;
  setLanguage: (language: Language) => void;
  t: (key: TranslationKey, options?: TranslateOptions) => string;
}

const STORAGE_KEY = "app_language";
const translations: Record<Language, Record<TranslationKey, string>> = { vi, en };
const I18nContext = createContext<I18nContextValue | null>(null);

function getInitialLanguage(): Language {
  const storedLanguage = window.localStorage.getItem(STORAGE_KEY);

  if (storedLanguage === "vi" || storedLanguage === "en") {
    return storedLanguage;
  }

  return navigator.language.toLowerCase().startsWith("vi") ? "vi" : "en";
}

function interpolate(message: string, options?: TranslateOptions): string {
  return message.replace(/{{(\w+)}}/g, (_, name: string) => String(options?.[name] ?? ""));
}

export function I18nProvider({ children }: PropsWithChildren) {
  const [language, setLanguage] = useState<Language>(getInitialLanguage);

  useEffect(() => {
    window.localStorage.setItem(STORAGE_KEY, language);
    document.documentElement.lang = language;
  }, [language]);

  const value = useMemo<I18nContextValue>(
    () => ({
      language,
      setLanguage,
      t: (key, options) => {
        const message = translations[language][key] ?? translations.vi[key] ?? key;
        return interpolate(message, options);
      },
    }),
    [language]
  );

  return <I18nContext.Provider value={value}>{children}</I18nContext.Provider>;
}

export function useI18n(): I18nContextValue {
  const value = useContext(I18nContext);

  if (!value) {
    throw new Error("useI18n must be used within I18nProvider");
  }

  return value;
}
