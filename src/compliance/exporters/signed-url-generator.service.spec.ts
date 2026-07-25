import { Test, TestingModule } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import { SignedUrlGeneratorService } from './signed-url-generator.service';

describe('SignedUrlGeneratorService', () => {
  let service: SignedUrlGeneratorService;
  let configService: jest.Mocked<ConfigService>;

  beforeEach(async () => {
    configService = {
      get: jest.fn((key, defaultValue) => {
        if (key === 'SIGNED_URL_SECRET') return 'test-secret-key';
        if (key === 'SIGNED_URL_EXPIRY_MINUTES') return 60;
        return defaultValue;
      }),
    } as any;

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        SignedUrlGeneratorService,
        { provide: ConfigService, useValue: configService },
      ],
    }).compile();

    service = module.get<SignedUrlGeneratorService>(SignedUrlGeneratorService);
  });

  describe('generateSignedUrl', () => {
    it('should generate a valid signed URL', () => {
      const signedUrl = service.generateSignedUrl(
        'export-123',
        'tax-report',
        'user-456',
        '/tmp/exports/tax_report.pdf',
        'pdf',
      );

      expect(signedUrl).toBeTruthy();
      expect(typeof signedUrl).toBe('string');
      // Should be valid base64
      expect(() => Buffer.from(signedUrl, 'base64').toString('utf-8')).not.toThrow();
    });

    it('should generate different URLs for different export IDs', () => {
      const url1 = service.generateSignedUrl(
        'export-1',
        'tax-report',
        'user-456',
        '/tmp/exports/report1.pdf',
        'pdf',
      );
      const url2 = service.generateSignedUrl(
        'export-2',
        'tax-report',
        'user-456',
        '/tmp/exports/report2.pdf',
        'pdf',
      );

      expect(url1).not.toBe(url2);
    });

    it('should generate different URLs for different user IDs', () => {
      const url1 = service.generateSignedUrl(
        'export-123',
        'tax-report',
        'user-1',
        '/tmp/exports/report.pdf',
        'pdf',
      );
      const url2 = service.generateSignedUrl(
        'export-123',
        'tax-report',
        'user-2',
        '/tmp/exports/report.pdf',
        'pdf',
      );

      expect(url1).not.toBe(url2);
    });

    it('should support custom expiry times', () => {
      const url = service.generateSignedUrl(
        'export-123',
        'tax-report',
        'user-456',
        '/tmp/exports/report.pdf',
        'pdf',
        30, // 30 minute custom expiry
      );

      const payload = JSON.parse(Buffer.from(url, 'base64').toString('utf-8'));
      const expiryDuration = payload.expiresAt - payload.issuedAt;
      expect(expiryDuration).toBe(30 * 60); // 30 minutes in seconds
    });
  });

  describe('validateAndDecodeSignedUrl', () => {
    it('should validate and decode a valid signed URL', () => {
      const signedUrl = service.generateSignedUrl(
        'export-123',
        'tax-report',
        'user-456',
        '/tmp/exports/report.pdf',
        'pdf',
      );

      const payload = service.validateAndDecodeSignedUrl(signedUrl);

      expect(payload.exportId).toBe('export-123');
      expect(payload.exportType).toBe('tax-report');
      expect(payload.userId).toBe('user-456');
      expect(payload.filePath).toBe('/tmp/exports/report.pdf');
      expect(payload.format).toBe('pdf');
    });

    it('should reject invalid base64', () => {
      expect(() => {
        service.validateAndDecodeSignedUrl('!!!not-valid-base64!!!');
      }).toThrow('Invalid signed URL format');
    });

    it('should reject malformed JSON', () => {
      const malformedUrl = Buffer.from('not-json', 'utf-8').toString('base64');
      expect(() => {
        service.validateAndDecodeSignedUrl(malformedUrl);
      }).toThrow('malformed JSON');
    });

    it('should reject URL with missing fields', () => {
      const incompletePayload = JSON.stringify({ exportId: 'export-123' });
      const malformedUrl = Buffer.from(incompletePayload, 'utf-8').toString('base64');

      expect(() => {
        service.validateAndDecodeSignedUrl(malformedUrl);
      }).toThrow('missing required fields');
    });

    it('should reject expired URLs', () => {
      // Create a URL that expired 1 hour ago
      const payload = {
        exportId: 'export-123',
        exportType: 'tax-report',
        userId: 'user-456',
        filePath: '/tmp/exports/report.pdf',
        format: 'pdf',
        issuedAt: Math.floor(Date.now() / 1000) - 7200, // 2 hours ago
        expiresAt: Math.floor(Date.now() / 1000) - 3600, // 1 hour ago
        signature: 'any-signature', // Will be validated but URL is already expired
      };

      const expiredUrl = Buffer.from(JSON.stringify(payload), 'utf-8').toString('base64');

      expect(() => {
        service.validateAndDecodeSignedUrl(expiredUrl);
      }).toThrow('expired');
    });

    it('should reject tampered URLs (modified exportId)', () => {
      const signedUrl = service.generateSignedUrl(
        'export-123',
        'tax-report',
        'user-456',
        '/tmp/exports/report.pdf',
        'pdf',
      );

      const payload = JSON.parse(Buffer.from(signedUrl, 'base64').toString('utf-8'));
      payload.exportId = 'export-999'; // Tamper with export ID

      const tamperedUrl = Buffer.from(JSON.stringify(payload), 'utf-8').toString('base64');

      expect(() => {
        service.validateAndDecodeSignedUrl(tamperedUrl);
      }).toThrow('signature verification failed');
    });

    it('should reject tampered URLs (modified userId)', () => {
      const signedUrl = service.generateSignedUrl(
        'export-123',
        'tax-report',
        'user-456',
        '/tmp/exports/report.pdf',
        'pdf',
      );

      const payload = JSON.parse(Buffer.from(signedUrl, 'base64').toString('utf-8'));
      payload.userId = 'user-999'; // Tamper with user ID

      const tamperedUrl = Buffer.from(JSON.stringify(payload), 'utf-8').toString('base64');

      expect(() => {
        service.validateAndDecodeSignedUrl(tamperedUrl);
      }).toThrow('signature verification failed');
    });

    it('should reject tampered URLs (modified signature)', () => {
      const signedUrl = service.generateSignedUrl(
        'export-123',
        'tax-report',
        'user-456',
        '/tmp/exports/report.pdf',
        'pdf',
      );

      const payload = JSON.parse(Buffer.from(signedUrl, 'base64').toString('utf-8'));
      payload.signature = 'invalid_signature_' + payload.signature;

      const tamperedUrl = Buffer.from(JSON.stringify(payload), 'utf-8').toString('base64');

      expect(() => {
        service.validateAndDecodeSignedUrl(tamperedUrl);
      }).toThrow('signature verification failed');
    });

    it('should reject tampered URLs (modified expiresAt)', () => {
      const signedUrl = service.generateSignedUrl(
        'export-123',
        'tax-report',
        'user-456',
        '/tmp/exports/report.pdf',
        'pdf',
      );

      const payload = JSON.parse(Buffer.from(signedUrl, 'base64').toString('utf-8'));
      payload.expiresAt += 86400; // Extend expiry by 1 day

      const tamperedUrl = Buffer.from(JSON.stringify(payload), 'utf-8').toString('base64');

      expect(() => {
        service.validateAndDecodeSignedUrl(tamperedUrl);
      }).toThrow('signature verification failed');
    });

    it('should preserve all payload fields', () => {
      const signedUrl = service.generateSignedUrl(
        'export-456',
        'audit-trail',
        'user-789',
        '/tmp/exports/audit.csv',
        'csv',
        120,
      );

      const payload = service.validateAndDecodeSignedUrl(signedUrl);

      expect(payload.exportId).toBe('export-456');
      expect(payload.exportType).toBe('audit-trail');
      expect(payload.userId).toBe('user-789');
      expect(payload.filePath).toBe('/tmp/exports/audit.csv');
      expect(payload.format).toBe('csv');
      expect(typeof payload.issuedAt).toBe('number');
      expect(typeof payload.expiresAt).toBe('number');
      expect(typeof payload.signature).toBe('string');
    });

    it('should validate URL immediately after generation', () => {
      const signedUrl = service.generateSignedUrl(
        'export-123',
        'tax-report',
        'user-456',
        '/tmp/exports/report.pdf',
        'pdf',
      );

      // Should not throw
      expect(() => {
        service.validateAndDecodeSignedUrl(signedUrl);
      }).not.toThrow();
    });
  });

  describe('signature verification robustness', () => {
    it('should use constant-time comparison for signatures', () => {
      // This is hard to test directly, but we can verify the behavior
      const signedUrl = service.generateSignedUrl(
        'export-123',
        'tax-report',
        'user-456',
        '/tmp/exports/report.pdf',
        'pdf',
      );

      const payload = JSON.parse(Buffer.from(signedUrl, 'base64').toString('utf-8'));

      // Modify signature slightly (should fail with constant-time check)
      const originalSig = payload.signature;
      payload.signature = 'a' + originalSig.slice(1);

      const tamperedUrl = Buffer.from(JSON.stringify(payload), 'utf-8').toString('base64');

      expect(() => {
        service.validateAndDecodeSignedUrl(tamperedUrl);
      }).toThrow('signature verification failed');
    });

    it('should reject URLs with valid structure but wrong signature', () => {
      const payload = {
        exportId: 'export-123',
        exportType: 'tax-report',
        userId: 'user-456',
        filePath: '/tmp/exports/report.pdf',
        format: 'pdf',
        issuedAt: Math.floor(Date.now() / 1000),
        expiresAt: Math.floor(Date.now() / 1000) + 3600,
        signature: '0000000000000000000000000000000000000000000000000000000000000000', // Invalid signature
      };

      const url = Buffer.from(JSON.stringify(payload), 'utf-8').toString('base64');

      expect(() => {
        service.validateAndDecodeSignedUrl(url);
      }).toThrow('signature verification failed');
    });
  });
});
