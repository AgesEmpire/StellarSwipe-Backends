import { Test, TestingModule } from '@nestjs/testing';
import { BadRequestException } from '@nestjs/common';
import { TemplateEngineService } from './template-engine.service';

describe('TemplateEngineService', () => {
  let service: TemplateEngineService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [TemplateEngineService],
    }).compile();

    service = module.get(TemplateEngineService);

    // Register test templates
    service.register('welcome', 'en', {
      subject: 'Welcome, {{name}}!',
      html: '<p>Hello {{name}}, click <a href="{{link}}">here</a></p>',
      variables: ['name', 'link'],
    });

    service.register('welcome', 'es', {
      subject: '¡Bienvenido, {{name}}!',
      html: '<p>Hola {{name}}, haz clic <a href="{{link}}">aquí</a></p>',
      variables: ['name', 'link'],
    });

    service.register('alert', 'en', {
      subject: 'Alert: {{type}}',
      html: '<p>Alert type: {{type}}</p>',
      variables: ['type'],
    });
  });

  describe('render', () => {
    it('renders English template correctly', () => {
      const result = service.render('welcome', { name: 'Alice', link: 'https://example.com' }, 'en');
      expect(result.subject).toBe('Welcome, Alice!');
      expect(result.html).toContain('Hello Alice');
      expect(result.html).toContain('https://example.com');
    });

    it('renders Spanish template when locale is es', () => {
      const result = service.render('welcome', { name: 'Carlos', link: 'https://example.com' }, 'es');
      expect(result.subject).toBe('¡Bienvenido, Carlos!');
      expect(result.html).toContain('Hola Carlos');
    });

    it('falls back to English when locale not found', () => {
      const result = service.render('welcome', { name: 'Bob', link: 'https://example.com' }, 'de');
      expect(result.subject).toBe('Welcome, Bob!');
    });

    it('throws BadRequestException for unknown template', () => {
      expect(() => service.render('nonexistent', {}, 'en')).toThrow(BadRequestException);
    });

    it('escapes XSS in variables by default', () => {
      const result = service.render('alert', { type: '<script>alert(1)</script>' }, 'en');
      expect(result.html).not.toContain('<script>');
      expect(result.html).toContain('&lt;script&gt;');
    });

    it('renders formatDate helper', () => {
      service.register('dated', 'en', {
        subject: 'Date test',
        html: '<p>{{formatDate date}}</p>',
      });
      const result = service.render('dated', { date: '2024-01-15T00:00:00Z' }, 'en');
      expect(result.html).toContain('January');
    });

    it('renders formatAmount helper', () => {
      service.register('amount', 'en', {
        subject: 'Amount test',
        html: '<p>{{formatAmount amount}}</p>',
      });
      const result = service.render('amount', { amount: 1234.56 }, 'en');
      expect(result.html).toContain('1,234.56');
    });
  });

  describe('hasTemplate', () => {
    it('returns true for registered template', () => {
      expect(service.hasTemplate('welcome', 'en')).toBe(true);
    });

    it('returns true via fallback to en', () => {
      expect(service.hasTemplate('welcome', 'de')).toBe(true);
    });

    it('returns false for unregistered template', () => {
      expect(service.hasTemplate('nonexistent', 'en')).toBe(false);
    });
  });

  describe('listTemplates', () => {
    it('lists all templates for a locale', () => {
      const templates = service.listTemplates('en');
      expect(templates).toContain('welcome');
      expect(templates).toContain('alert');
    });
  });

  describe('security', () => {
    it('prevents template injection via dynamic template names', () => {
      // Attempting to render a template that was never registered should throw
      expect(() => service.render('../../etc/passwd', {}, 'en')).toThrow(BadRequestException);
    });
  });
});
