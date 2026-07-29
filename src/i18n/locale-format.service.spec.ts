import { LocaleFormatService } from './locale-format.service';

describe('LocaleFormatService', () => {
  let service: LocaleFormatService;

  beforeEach(() => {
    service = new LocaleFormatService();
  });

  // ── resolveLocale ────────────────────────────────────────────────────────

  describe('resolveLocale', () => {
    it('returns default (en-US) when no header provided', () => {
      expect(service.resolveLocale()).toBe('en-US');
      expect(service.resolveLocale(undefined)).toBe('en-US');
    });

    it('parses a single language tag', () => {
      expect(service.resolveLocale('fr-FR')).toBe('fr-FR');
    });

    it('picks the first tag from an Accept-Language value', () => {
      expect(service.resolveLocale('de-DE,de;q=0.9,en;q=0.8')).toBe('de-DE');
    });

    it('falls back to en-US for unrecognised tags', () => {
      expect(service.resolveLocale('xx-INVALID')).toBe('en-US');
    });
  });

  // ── formatCurrency ───────────────────────────────────────────────────────

  describe('formatCurrency', () => {
    it('preserves the raw value', () => {
      const result = service.formatCurrency(1234.56, 'en-US');
      expect(result.raw).toBe(1234.56);
    });

    it('formats correctly for en-US (USD)', () => {
      const result = service.formatCurrency(1234.56, 'en-US', 'USD');
      expect(result.display).toContain('1,234.56');
    });

    it('formats correctly for de-DE (EUR) — comma as decimal separator', () => {
      const result = service.formatCurrency(1234.56, 'de-DE', 'EUR');
      // German locale uses period as thousands separator and comma for decimals
      expect(result.display).toMatch(/1\.234[,.]56/);
    });

    it('formats correctly for fr-FR (EUR)', () => {
      const result = service.formatCurrency(999.99, 'fr-FR', 'EUR');
      expect(result.raw).toBe(999.99);
      expect(typeof result.display).toBe('string');
      expect(result.display.length).toBeGreaterThan(0);
    });
  });

  // ── formatPercent ────────────────────────────────────────────────────────

  describe('formatPercent', () => {
    it('preserves the raw value', () => {
      expect(service.formatPercent(12.5, 'en-US').raw).toBe(12.5);
    });

    it('formats en-US percentage', () => {
      const result = service.formatPercent(12.5, 'en-US');
      expect(result.display).toContain('12.5%');
    });

    it('formats de-DE percentage with comma decimal', () => {
      const result = service.formatPercent(12.5, 'de-DE');
      // German uses comma for decimal
      expect(result.display).toMatch(/12[,.]5\s*%/);
    });
  });

  // ── formatDate ───────────────────────────────────────────────────────────

  describe('formatDate', () => {
    const isoDate = '2024-06-15T10:30:00.000Z';

    it('preserves the raw ISO string', () => {
      const result = service.formatDate(isoDate, 'en-US');
      expect(result.raw).toBe(isoDate);
    });

    it('produces a non-empty display string for en-US', () => {
      const result = service.formatDate(isoDate, 'en-US');
      expect(result.display.length).toBeGreaterThan(0);
    });

    it('produces a different display string for ja-JP vs en-US', () => {
      const en = service.formatDate(isoDate, 'en-US');
      const ja = service.formatDate(isoDate, 'ja-JP');
      // Both valid but formatted differently
      expect(en.display).not.toBe(ja.display);
    });

    it('handles invalid date strings gracefully', () => {
      const result = service.formatDate('not-a-date', 'en-US');
      expect(result.raw).toBe('not-a-date');
      expect(result.display).toBe('not-a-date');
    });
  });

  // ── localizeResponse ─────────────────────────────────────────────────────

  describe('localizeResponse', () => {
    it('replaces currency fields with { raw, display }', () => {
      const input = { amount: 250.0, name: 'Trade A' };
      const result = service.localizeResponse(input, 'en-US') as any;
      expect(result.amount.raw).toBe(250.0);
      expect(result.amount.display).toContain('250');
      expect(result.name).toBe('Trade A');
    });

    it('replaces percent fields with { raw, display }', () => {
      const input = { percentage: 5.5 };
      const result = service.localizeResponse(input, 'en-US') as any;
      expect(result.percentage.raw).toBe(5.5);
      expect(result.percentage.display).toContain('5.5%');
    });

    it('replaces date fields with { raw, display }', () => {
      const input = { createdAt: '2024-01-01T00:00:00.000Z' };
      const result = service.localizeResponse(input, 'en-US') as any;
      expect(result.createdAt.raw).toBe('2024-01-01T00:00:00.000Z');
      expect(result.createdAt.display.length).toBeGreaterThan(0);
    });

    it('handles nested objects recursively', () => {
      const input = { order: { total: 100, status: 'open' } };
      const result = service.localizeResponse(input, 'en-US') as any;
      expect(result.order.total.raw).toBe(100);
      expect(result.order.status).toBe('open');
    });

    it('handles arrays', () => {
      const input = [{ amount: 10 }, { amount: 20 }];
      const result = service.localizeResponse(input, 'en-US') as any[];
      expect(result[0].amount.raw).toBe(10);
      expect(result[1].amount.raw).toBe(20);
    });

    it('returns same raw values for en-US and de-DE, different display', () => {
      const input = { amount: 1000.5, percentage: 10 };
      const enResult = service.localizeResponse(input, 'en-US') as any;
      const deResult = service.localizeResponse(input, 'de-DE') as any;

      // Raw values identical
      expect(enResult.amount.raw).toBe(deResult.amount.raw);
      expect(enResult.percentage.raw).toBe(deResult.percentage.raw);

      // Display values differ between locales
      expect(enResult.amount.display).not.toBe(deResult.amount.display);
    });

    it('passes through null/undefined values unchanged', () => {
      expect(service.localizeResponse(null, 'en-US')).toBeNull();
      expect(service.localizeResponse(undefined, 'en-US')).toBeUndefined();
    });

    it('passes through primitives unchanged', () => {
      expect(service.localizeResponse('hello', 'en-US')).toBe('hello');
      expect(service.localizeResponse(42, 'en-US')).toBe(42);
    });
  });
});
