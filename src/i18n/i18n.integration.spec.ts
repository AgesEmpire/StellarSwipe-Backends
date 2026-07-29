import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication } from '@nestjs/common';
import * as request from 'supertest';
import { I18nModule } from './i18n.module';
import { I18nAppService } from './i18n.service';
import { ConfigModule } from '@nestjs/config';

describe('I18n Integration Tests', () => {
  let app: INestApplication;
  let i18nService: I18nAppService;

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [
        ConfigModule.forRoot({
          isGlobal: true,
          load: [
            () => ({
              app: {
                fallbackLanguage: 'en',
              },
            }),
          ],
        }),
        I18nModule,
      ],
    }).compile();

    app = moduleFixture.createNestApplication();
    i18nService = moduleFixture.get<I18nAppService>(I18nAppService);
    await app.init();
  });

  afterAll(async () => {
    await app.close();
  });

  describe('Translation Service', () => {
    it('should translate error messages to English', async () => {
      const translated = await i18nService.translate('errors.USER_NOT_FOUND', 'en');
      expect(translated).toBe('User not found');
    });

    it('should translate error messages to Spanish', async () => {
      const translated = await i18nService.translate('errors.USER_NOT_FOUND', 'es');
      expect(translated).toBe('Usuario no encontrado');
    });

    it('should translate error messages to French', async () => {
      const translated = await i18nService.translate('errors.USER_NOT_FOUND', 'fr');
      expect(translated).toBe('Utilisateur non trouvé');
    });

    it('should handle translation with parameters', async () => {
      const translated = await i18nService.translate('errors.DAILY_LIMIT_REACHED', 'en', {
        limit: '1000',
        currency: 'USD',
      });
      expect(translated).toContain('1000');
      expect(translated).toContain('USD');
    });

    it('should fallback to English for unsupported language', async () => {
      const translated = await i18nService.translate('errors.USER_NOT_FOUND', 'de');
      expect(translated).toBe('User not found');
    });

    it('should return key if translation not found', async () => {
      const translated = await i18nService.translate('errors.NON_EXISTENT_KEY', 'en');
      expect(translated).toBe('errors.NON_EXISTENT_KEY');
    });
  });

  describe('Language Detection', () => {
    it('should detect language from Accept-Language header', () => {
      const lang = i18nService.getSupportedLanguage('es-ES');
      expect(lang).toBe('es');
    });

    it('should detect language from custom header', () => {
      const lang = i18nService.getSupportedLanguage('fr');
      expect(lang).toBe('fr');
    });

    it('should fallback to English for unsupported language', () => {
      const lang = i18nService.getSupportedLanguage('de-DE');
      expect(lang).toBe('en');
    });

    it('should return English for null language', () => {
      const lang = i18nService.getSupportedLanguage(null);
      expect(lang).toBe('en');
    });
  });

  describe('Supported Languages', () => {
    it('should return list of supported languages', () => {
      const languages = i18nService.getSupportedLanguages();
      expect(languages).toContain('en');
      expect(languages).toContain('es');
      expect(languages).toContain('fr');
      expect(languages.length).toBeGreaterThan(0);
    });
  });
});
