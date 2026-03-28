import i18n from 'i18next';
import { initReactI18next } from 'react-i18next';
import en from './locales/en';
import zh from './locales/zh';

const savedLang = (() => {
  try { return localStorage.getItem('lang') ?? 'en'; } catch { return 'en'; }
})();

void i18n
  .use(initReactI18next)
  .init({
    resources: {
      en: { translation: en },
      zh: { translation: zh },
    },
    lng: savedLang,
    fallbackLng: 'en',
    interpolation: {
      escapeValue: false,
    },
  });

export function setLanguage(lang: 'en' | 'zh') {
  void i18n.changeLanguage(lang);
  try { localStorage.setItem('lang', lang); } catch { /* storage unavailable */ }
}

export { i18n };
