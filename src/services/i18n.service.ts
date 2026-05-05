import { DOCUMENT } from '@angular/common';
import { Injectable, effect, inject, signal } from '@angular/core';
import { Locale } from '../types/locale';
import { SUPPORTED_LOCALES, TranslationParams, resolveLocale, translate } from '../i18n/catalog';

const LOCALE_STORAGE_KEY = 'csv-to-sql-converter.locale';

@Injectable({
  providedIn: 'root'
})
export class I18nService {
  private document = inject(DOCUMENT);
  private localeSignal = signal<Locale>(this.resolveInitialLocale());

  readonly locale = this.localeSignal.asReadonly();
  readonly supportedLocales = SUPPORTED_LOCALES;

  constructor() {
    effect(() => {
      const locale = this.locale();

      this.document.documentElement.lang = locale;
      this.document.title = this.t('meta.title');

      try {
        localStorage.setItem(LOCALE_STORAGE_KEY, locale);
      } catch {
        // Ignore storage write failures and keep runtime locale only.
      }
    });
  }

  setLocale(locale: Locale) {
    this.localeSignal.set(locale);
  }

  t(key: string, params?: TranslationParams): string {
    return translate(this.locale(), key, params);
  }

  private resolveInitialLocale(): Locale {
    try {
      const stored = resolveLocale(localStorage.getItem(LOCALE_STORAGE_KEY));
      if (stored) return stored;
    } catch {
      // Ignore storage read failures and fall back to browser locale.
    }

    const browserLocales = navigator.languages?.length ? navigator.languages : [navigator.language];
    for (const candidate of browserLocales) {
      const locale = resolveLocale(candidate);
      if (locale) return locale;
    }

    return 'pt-BR';
  }
}
