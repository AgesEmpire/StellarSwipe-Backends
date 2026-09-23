import { Test, TestingModule } from '@nestjs/testing';
import { AuditService } from './audit.service';

describe('AuditService', () => {
  let service: AuditService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [AuditService],
    }).compile();

    service = module.get<AuditService>(AuditService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  describe('redaction of sensitive fields', () => {
    it('redacts top-level sensitive fields in request, entity, and metadata', () => {
      const event = service.redact({
        request: {
          headers: {
            authorization: 'Bearer super-secret-token',
            cookie: 'session=abc123',
            'x-api-key': 'key-123',
            'content-type': 'application/json',
          },
          body: {
            password: 'p@ssw0rd',
            username: 'alice',
          },
        },
        entity: {
          id: 'user-1',
          apiKey: 'entity-key',
          secret: 'entity-secret',
        },
        metadata: {
          token: 'meta-token',
          accessToken: 'meta-access-token',
          note: 'visible',
        },
      });

      expect(event.request.headers.authorization).toBe('[REDACTED]');
      expect(event.request.headers.cookie).toBe('[REDACTED]');
      expect(event.request.headers['x-api-key']).toBe('[REDACTED]');
      expect(event.request.headers['content-type']).toBe('application/json');
      expect(event.request.body.password).toBe('[REDACTED]');
      expect(event.request.body.username).toBe('alice');
      expect(event.entity.apiKey).toBe('[REDACTED]');
      expect(event.entity.secret).toBe('[REDACTED]');
      expect(event.entity.id).toBe('user-1');
      expect(event.metadata.token).toBe('[REDACTED]');
      expect(event.metadata.accessToken).toBe('[REDACTED]');
      expect(event.metadata.note).toBe('visible');
    });

    it('redacts nested objects and arrays recursively', () => {
      const event = service.redact({
        request: {
          body: {
            user: {
              profile: {
                password: 'nested-password',
                name: 'Bob',
              },
              tokens: [
                { accessToken: 'nested-access', label: 'primary' },
                { refreshToken: 'nested-refresh', label: 'secondary' },
              ],
            },
          },
        },
        entity: {
          credentials: {
            privateKey: 'nested-private-key',
            publicKey: 'nested-public-key',
          },
        },
        metadata: {
          items: [
            { secret: 'array-secret', id: 1 },
            { apiKey: 'array-api-key', id: 2 },
          ],
        },
      });

      expect(event.request.body.user.profile.password).toBe('[REDACTED]');
      expect(event.request.body.user.profile.name).toBe('Bob');
      expect(event.request.body.user.tokens[0].accessToken).toBe('[REDACTED]');
      expect(event.request.body.user.tokens[0].label).toBe('primary');
      expect(event.request.body.user.tokens[1].refreshToken).toBe('[REDACTED]');
      expect(event.request.body.user.tokens[1].label).toBe('secondary');
      expect(event.entity.credentials.privateKey).toBe('[REDACTED]');
      expect(event.entity.credentials.publicKey).toBe('[REDACTED]');
      expect(event.metadata.items[0].secret).toBe('[REDACTED]');
      expect(event.metadata.items[0].id).toBe(1);
      expect(event.metadata.items[1].apiKey).toBe('[REDACTED]');
      expect(event.metadata.items[1].id).toBe(2);
    });

    it('never leaks sensitive values into audit storage', () => {
      const secrets = [
        'Bearer super-secret-token',
        'p@ssw0rd',
        'entity-key',
        'entity-secret',
        'meta-token',
        'meta-access-token',
        'nested-password',
        'nested-access',
        'nested-refresh',
        'nested-private-key',
        'array-secret',
        'array-api-key',
      ];

      const event = service.redact({
        request: {
          headers: { authorization: 'Bearer super-secret-token' },
          body: { password: 'p@ssw0rd' },
        },
        entity: { apiKey: 'entity-key', secret: 'entity-secret' },
        metadata: {
          token: 'meta-token',
          accessToken: 'meta-access-token',
          nested: {
            password: 'nested-password',
            tokens: [
              { accessToken: 'nested-access' },
              { refreshToken: 'nested-refresh' },
            ],
            privateKey: 'nested-private-key',
          },
          items: [
            { secret: 'array-secret' },
            { apiKey: 'array-api-key' },
          ],
        },
      });

      const serialized = JSON.stringify(event);
      for (const secret of secrets) {
        expect(serialized).not.toContain(secret);
      }
    });
  });
});
