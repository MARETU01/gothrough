import i18n from 'i18next';
import { initReactI18next } from 'react-i18next';
import zhCN from './locales/zh-CN.json';
import en from './locales/en.json';

export const LANGUAGE_STORAGE_KEY = 'gothrough.language';
export const supportedLanguages = ['zh-CN', 'en'] as const;
export type Language = typeof supportedLanguages[number];

export function detectLanguage(storage?: Pick<Storage, 'getItem'>, languages: readonly string[] = []): Language {
  try {
    const saved = storage?.getItem(LANGUAGE_STORAGE_KEY);
    if (supportedLanguages.includes(saved as Language)) return saved as Language;
  } catch { /* Browsers may block storage. Language switching still works. */ }
  for (const language of languages) {
    if (/^zh(?:-|$)/i.test(language)) return 'zh-CN';
    if (/^en(?:-|$)/i.test(language)) return 'en';
  }
  return 'zh-CN';
}

function initialLanguage(): Language {
  const languages = typeof navigator === 'undefined' ? [] : navigator.languages;
  try { return detectLanguage(window.localStorage, languages); }
  catch { return detectLanguage(undefined, languages); }
}

// Keep small, offline-ready dictionaries in the bundle. Literal Chinese keys
// keep static copy readable; parameterized messages use named keys.
void i18n.use(initReactI18next).init({
  resources: { 'zh-CN': { translation: zhCN }, en: { translation: en } },
  lng: initialLanguage(),
  supportedLngs: [...supportedLanguages],
  fallbackLng: 'zh-CN',
  keySeparator: false,
  nsSeparator: false,
  interpolation: { escapeValue: false },
  initAsync: false,
});

function updateDocument(language: string) {
  if (typeof document !== 'undefined') document.documentElement.lang = language;
}
updateDocument(i18n.resolvedLanguage ?? 'zh-CN');
i18n.on('languageChanged', language => {
  updateDocument(language);
  try { window.localStorage.setItem(LANGUAGE_STORAGE_KEY, language); }
  catch { /* Storage is optional. */ }
});

export default i18n;
