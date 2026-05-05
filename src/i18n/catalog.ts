import ptBr from './pt-BR.json';
import en from './en.json';
import { Locale, SUPPORTED_LOCALES } from '../types/locale';

interface TranslationDictionary {
  [key: string]: string | TranslationDictionary;
}

type TranslationParams = Record<string, string | number | boolean | null | undefined>;

const TRANSLATIONS: Record<Locale, TranslationDictionary> = {
  'pt-BR': ptBr as TranslationDictionary,
  en: en as TranslationDictionary
};

export { SUPPORTED_LOCALES };
export type { TranslationParams };

export function isLocale(value: string): value is Locale {
  return (SUPPORTED_LOCALES as readonly string[]).includes(value);
}

export function resolveLocale(value: string | null | undefined): Locale | null {
  if (!value) return null;
  if (isLocale(value)) return value;

  const normalized = value.toLowerCase();
  if (normalized.startsWith('pt')) return 'pt-BR';
  if (normalized.startsWith('en')) return 'en';

  return null;
}

export function translate(locale: Locale, key: string, params?: TranslationParams): string {
  const raw = getValue(TRANSLATIONS[locale], key);

  if (typeof raw !== 'string') {
    return key;
  }

  if (!params) {
    return raw;
  }

  return raw.replace(/\{\{\s*(\w+)\s*\}\}/g, (_, token: string) => {
    const value = params[token];
    return value === undefined || value === null ? '' : String(value);
  });
}

function getValue(
  dictionary: TranslationDictionary,
  key: string
): string | TranslationDictionary | undefined {
  return key.split('.').reduce<string | TranslationDictionary | undefined>((current, part) => {
    if (!current || typeof current === 'string') {
      return undefined;
    }

    return current[part];
  }, dictionary);
}
