import { Injectable } from '@nestjs/common';

const SUPPORTED_LOCALES = new Set([
  'en', 'fr', 'de', 'es', 'pt', 'ar', 'zh', 'ja', 'ko', 'hi',
  'sw', 'yo', 'ha', 'ig', 'am', 'ru', 'tr', 'it', 'nl', 'pl',
  'en-US', 'en-GB', 'pt-BR', 'zh-CN', 'zh-TW',
]);

@Injectable()
export class TranslationValidator {
  isSupportedLocale(locale: string): boolean {
    return SUPPORTED_LOCALES.has(locale);
  }

  getSupportedLocales(): string[] {
    return [...SUPPORTED_LOCALES];
  }

  normalizeLocale(locale: string): string {
    const parts = locale.split('-');
    if (parts.length === 1) return parts[0].toLowerCase();
    return `${parts[0].toLowerCase()}-${parts[1].toUpperCase()}`;
  }

  isComplete(title: string, body: string): boolean {
    return title.trim().length > 0 && body.trim().length > 10;
  }

  detectMissingPlaceholders(original: string, translation: string): string[] {
    const placeholderRegex = /\{\{(\w+)\}\}/g;
    const originalPlaceholders = new Set<string>();
    const translationPlaceholders = new Set<string>();

    let match: RegExpExecArray | null;
    while ((match = placeholderRegex.exec(original)) !== null) {
      originalPlaceholders.add(match[1]);
    }

    placeholderRegex.lastIndex = 0;
    while ((match = placeholderRegex.exec(translation)) !== null) {
      translationPlaceholders.add(match[1]);
    }

    return [...originalPlaceholders].filter((p) => !translationPlaceholders.has(p));
  }
}
