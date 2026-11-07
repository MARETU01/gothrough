import i18n from 'i18next';
import { initReactI18next } from 'react-i18next';

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

const localeLoaders = {
  'zh-CN': () => import('./locales/zh-CN.json').then(module => module.default),
  en: () => import('./locales/en.json').then(module => module.default),
};

async function initialize() {
  let language = initialLanguage();
  let dictionary;
  try {
    dictionary = await localeLoaders[language]();
  } catch (error) {
    if (language === 'zh-CN') throw error;
    language = 'zh-CN';
    dictionary = await localeLoaders[language]();
  }
  await i18n.use(initReactI18next).init({
    resources: { [language]: { translation: dictionary } },
    lng: language,
    supportedLngs: [...supportedLanguages],
    // Both dictionaries have complete, matching keys (checked in tests).
    // Avoid loading an additional fallback dictionary on an English visit.
    fallbackLng: false,
    load: 'currentOnly',
    keySeparator: false,
    nsSeparator: false,
    interpolation: { escapeValue: false },
    initAsync: false,
  });
}

// Rendering and language changes wait until the initial dictionary is ready.
export const i18nReady = initialize();

export async function changeLanguage(language: Language) {
  await i18nReady;
  if (!i18n.hasResourceBundle(language, 'translation')) {
    const dictionary = await localeLoaders[language]();
    i18n.addResourceBundle(language, 'translation', dictionary);
  }
  // Keep the current UI and saved preference if downloading the locale fails.
  await i18n.changeLanguage(language);
}

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
