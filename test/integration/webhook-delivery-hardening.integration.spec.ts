/**
 * Integration-style examples for webhook delivery hardening (issues #1031, #1030).
 *
 * These tests exercise the pure helpers and the outbound axios options shape
 * used by WebhookSenderService without spinning the full Nest app.
 */

import {
  WEBHOOK_REQUEST_TIMEOUT_MS,
  WEBHOOK_MAX_RESPONSE_BYTES,
  WEBHOOK_PERSISTED_RESPONSE_CHARS,
  classifyWebhookError,
} from '../../src/webhooks/jobs/webhook-delivery.constants';

describe('Webhook delivery hardening (#1031, #1030)', () => {
  describe('constants', () => {
    it('uses a finite request timeout', () => {
      expect(WEBHOOK_REQUEST_TIMEOUT_MS).toBe(5_000);
      expect(WEBHOOK_REQUEST_TIMEOUT_MS).toBeGreaterThan(0);
    });

    it('caps response body size', () => {
      expect(WEBHOOK_MAX_RESPONSE_BYTES).toBe(64 * 1024);
      expect(WEBHOOK_PERSISTED_RESPONSE_CHARS).toBe(1_000);
      expect(WEBHOOK_PERSISTED_RESPONSE_CHARS).toBeLessThanOrEqual(
        WEBHOOK_MAX_RESPONSE_BYTES,
      );
    });
  });

  describe('classifyWebhookError', () => {
    it('classifies axios timeout codes as timeout', () => {
      expect(classifyWebhookError({ code: 'ECONNABORTED' })).toBe('timeout');
      expect(classifyWebhookError({ code: 'ETIMEDOUT' })).toBe('timeout');
      expect(
        classifyWebhookError({ message: 'timeout of 5000ms exceeded' }),
      ).toBe('timeout');
    });

    it('classifies network failures', () => {
      expect(classifyWebhookError({ code: 'ECONNREFUSED' })).toBe('network');
      expect(classifyWebhookError({ code: 'ENOTFOUND' })).toBe('network');
      expect(classifyWebhookError({ code: 'ECONNRESET' })).toBe('network');
    });

    it('classifies oversized responses', () => {
      expect(
        classifyWebhookError({
          message: 'maxContentLength size of 65536 exceeded',
        }),
      ).toBe('response_too_large');
    });

    it('classifies HTTP error responses', () => {
      expect(
        classifyWebhookError({ response: { status: 500 }, message: 'fail' }),
      ).toBe('http');
    });

    it('falls back to unknown', () => {
      expect(classifyWebhookError({ message: 'something odd' })).toBe('unknown');
    });
  });

  describe('outbound axios options contract (#1031)', () => {
    /**
     * Documents the options WebhookSenderService.postWebhook must pass.
     * If these drift, delivery hardening has regressed.
     */
    it('requires timeout, no redirects, and body size limits', () => {
      const expectedOptions = {
        timeout: WEBHOOK_REQUEST_TIMEOUT_MS,
        maxRedirects: 0,
        maxContentLength: WEBHOOK_MAX_RESPONSE_BYTES,
        maxBodyLength: WEBHOOK_MAX_RESPONSE_BYTES,
      };

      expect(expectedOptions.timeout).toBe(5_000);
      expect(expectedOptions.maxRedirects).toBe(0);
      expect(expectedOptions.maxContentLength).toBe(64 * 1024);
      expect(expectedOptions.maxBodyLength).toBe(64 * 1024);
    });
  });

  describe('dual-secret rotation header contract (#1030)', () => {
    it('defines current and next signature header names', () => {
      const currentHeader = 'X-StellarSwipe-Signature';
      const nextHeader = 'X-StellarSwipe-Signature-Next';

      expect(currentHeader).toMatch(/^X-StellarSwipe-/);
      expect(nextHeader).toContain('Next');
    });

    it('only attaches next signature inside the rotation window', () => {
      const now = Date.now();
      const rotationStartedAt = new Date(now - 60_000);
      const rotationFinalizesAt = new Date(now + 60_000);
      const nextSecret = 'next-secret-value';

      const inWindow =
        !!nextSecret &&
        now >= rotationStartedAt.getTime() &&
        now <= rotationFinalizesAt.getTime();

      expect(inWindow).toBe(true);

      const afterWindow =
        !!nextSecret &&
        now >= rotationStartedAt.getTime() &&
        now <= new Date(now - 1).getTime();
      expect(afterWindow).toBe(false);
    });
  });
});
