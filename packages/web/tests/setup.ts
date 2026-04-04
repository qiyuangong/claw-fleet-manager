import '@testing-library/jest-dom';
import i18n from 'i18next';
import { initReactI18next } from 'react-i18next';

if (!i18n.isInitialized) {
  void i18n.use(initReactI18next).init({
    lng: 'en',
    resources: {},
    fallbackLng: false,
    showSupportNotice: false,
    parseMissingKeyHandler: (key) => key,
  });
}
