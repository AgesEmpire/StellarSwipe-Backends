import { Test, TestingModule } from '@nestjs/testing';
import { I18nAppService } from './i18n.service';
import { I18nService } from 'nestjs-i18n';

describe('I18nAppService', () => {
    let service: I18nAppService;
    let i18nServiceMock: { translate: jest.Mock };

    beforeEach(async () => {
        i18nServiceMock = { translate: jest.fn() };

        const module: TestingModule = await Test.createTestingModule({
            providers: [
                I18nAppService,
                { provide: I18nService, useValue: i18nServiceMock },
            ],
        }).compile();

        service = module.get<I18nAppService>(I18nAppService);
    });

    it('should be defined', () => {
        expect(service).toBeDefined();
    });

    describe('translate', () => {
        it('translates a key in English (en)', async () => {
            i18nServiceMock.translate.mockResolvedValue('Invalid price provided');
            const result = await service.translate('errors.INVALID_PRICE', 'en');
            expect(i18nServiceMock.translate).toHaveBeenCalledWith('errors.INVALID_PRICE', { lang: 'en', args: undefined });
            expect(result).toBe('Invalid price provided');
        });

        it('translates a key in Spanish (es)', async () => {
            i18nServiceMock.translate.mockResolvedValue('Precio inválido proporcionado');
            const result = await service.translate('errors.INVALID_PRICE', 'es');
            expect(i18nServiceMock.translate).toHaveBeenCalledWith('errors.INVALID_PRICE', { lang: 'es', args: undefined });
            expect(result).toBe('Precio inválido proporcionado');
        });

        it('falls back to key when translation is missing', async () => {
            i18nServiceMock.translate.mockRejectedValue(new Error('Translation not found'));
            const result = await service.translate('errors.NON_EXISTENT_KEY', 'en');
            expect(result).toBe('errors.NON_EXISTENT_KEY');
        });

        it('passes interpolation args to the underlying service', async () => {
            i18nServiceMock.translate.mockResolvedValue('Quota exceeded. Resets at 2024-01-01');
            const result = await service.translate('errors.QUOTA_EXCEEDED', 'en', { resetAt: '2024-01-01' });
            expect(i18nServiceMock.translate).toHaveBeenCalledWith('errors.QUOTA_EXCEEDED', {
                lang: 'en',
                args: { resetAt: '2024-01-01' },
            });
            expect(result).toContain('2024-01-01');
        });

        it('translates labels namespace key in French (fr)', async () => {
            i18nServiceMock.translate.mockResolvedValue('Solde du Portefeuille');
            const result = await service.translate('labels.WALLET_BALANCE', 'fr');
            expect(result).toBe('Solde du Portefeuille');
        });
    });

    describe('getSupportedLanguage', () => {
        it('returns the language when supported', () => {
            expect(service.getSupportedLanguage('en')).toBe('en');
            expect(service.getSupportedLanguage('es')).toBe('es');
            expect(service.getSupportedLanguage('fr')).toBe('fr');
            expect(service.getSupportedLanguage('yo')).toBe('yo');
            expect(service.getSupportedLanguage('ig')).toBe('ig');
            expect(service.getSupportedLanguage('ha')).toBe('ha');
        });

        it('extracts base language from locale tag', () => {
            expect(service.getSupportedLanguage('en-US')).toBe('en');
            expect(service.getSupportedLanguage('es-ES')).toBe('es');
            expect(service.getSupportedLanguage('yo-NG')).toBe('yo');
        });

        it('falls back to en for unsupported languages', () => {
            expect(service.getSupportedLanguage('de')).toBe('en');
            expect(service.getSupportedLanguage('zh')).toBe('en');
            expect(service.getSupportedLanguage('')).toBe('en');
            expect(service.getSupportedLanguage(null as any)).toBe('en');
        });
    });

    describe('getSupportedLanguages', () => {
        it('returns all supported language codes', () => {
            const langs = service.getSupportedLanguages();
            expect(langs).toEqual(expect.arrayContaining(['en', 'es', 'fr', 'yo', 'ig', 'ha']));
            expect(langs.length).toBe(6);
        });
    });
});
