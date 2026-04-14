import '@testing-library/jest-dom';
import i18n from 'i18next';
import { initReactI18next } from 'react-i18next';

function createStorage() {
  const data = new Map<string, string>();

  return {
    get length() {
      return data.size;
    },
    clear() {
      data.clear();
    },
    getItem(key: string) {
      return data.has(key) ? data.get(key)! : null;
    },
    key(index: number) {
      return [...data.keys()][index] ?? null;
    },
    removeItem(key: string) {
      data.delete(key);
    },
    setItem(key: string, value: string) {
      data.set(key, String(value));
    },
  };
}

function ensureStorage(name: 'localStorage' | 'sessionStorage') {
  if (typeof window === 'undefined') return;
  const storage = window[name];
  if (
    storage &&
    typeof storage.getItem === 'function' &&
    typeof storage.setItem === 'function' &&
    typeof storage.removeItem === 'function' &&
    typeof storage.clear === 'function'
  ) {
    return;
  }

  Object.defineProperty(window, name, {
    configurable: true,
    value: createStorage(),
  });
}

ensureStorage('localStorage');
ensureStorage('sessionStorage');

if (!i18n.isInitialized) {
  void i18n.use(initReactI18next).init({
    lng: 'en',
    resources: {},
    fallbackLng: false,
    showSupportNotice: false,
    parseMissingKeyHandler: (key) => key,
  });
}
