import { Injectable, Logger } from '@nestjs/common';
import { I18nService } from 'nestjs-i18n';

@Injectable()
export class I18nAppService {
    private readonly logger = new Logger(I18nAppService.name);

    constructor(private readonly i18n: I18nService) { }

    /**
     * Translates a message key to the specified language
     * @param key The translation key, e.g., 'errors.INVALID_PRICE'
     * @param lang The language code, e.g., 'en', 'yo'
     * @param args Optional arguments to pass to the translation string
     * @returns Translated string
     */
    async translate(key: string, lang: string = 'en', args?: Record<string, any>): Promise<string> {
        try {
            const translated = await this.i18n.translate(key, {
                lang,
                args,
            });
            return translated as string;
        } catch (error) {
            this.logger.error(`Failed to translate key: ${key} for language: ${lang}`, error);
            // Fallback to key if translation fails
            return key;
        }
    }

    /**
     * Standardizes language code to the supported ones
     * @param lang The raw language code
     * @returns A supported language code
     */
    getSupportedLanguage(lang: string): string {
        if (!lang) return 'en';

        // Extract base language code (e.g., 'en-US' -> 'en')
        const baseLang = lang.split('-')[0].toLowerCase();

        const supported = ['en', 'es', 'fr', 'yo', 'ig', 'ha'];
        return supported.includes(baseLang) ? baseLang : 'en';
    }

    /**
     * Get list of all supported languages
     * @returns Array of supported language codes
     */
    getSupportedLanguages(): string[] {
        return ['en', 'es', 'fr', 'yo', 'ig', 'ha'];
    }
}
