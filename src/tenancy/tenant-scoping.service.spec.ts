import { Test, TestingModule } from '@nestjs/testing';
import { ForbiddenException, UnauthorizedException } from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { TenantScopingService } from './tenant-scoping.service';
import { tenantStorage } from './tenant-context';

const mockEventEmitter = () => ({ emit: jest.fn() });

/** Helper: run a callback inside a tenant context. */
function withTenant<T>(tenantId: string, fn: () => T): T {
  return tenantStorage.run({ tenantId }, fn);
}

describe('TenantScopingService', () => {
  let service: TenantScopingService;
  let emitter: ReturnType<typeof mockEventEmitter>;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        TenantScopingService,
        { provide: EventEmitter2, useFactory: mockEventEmitter },
      ],
    }).compile();

    service = module.get(TenantScopingService);
    emitter = module.get(EventEmitter2);
  });

  // ── scopeQuery ────────────────────────────────────────────────────────────

  describe('scopeQuery', () => {
    it('adds tenant_id WHERE clause to query builder', () => {
      const qb: any = {
        alias: 'entity',
        andWhere: jest.fn().mockReturnThis(),
      };

      withTenant('tenant-abc', () => service.scopeQuery(qb));

      expect(qb.andWhere).toHaveBeenCalledWith(
        'entity.tenant_id = :__tenantId',
        { __tenantId: 'tenant-abc' },
      );
    });

    it('uses provided alias override', () => {
      const qb: any = {
        alias: 'entity',
        andWhere: jest.fn().mockReturnThis(),
      };

      withTenant('tenant-xyz', () =>
        service.scopeQuery(qb, { alias: 'custom' }),
      );

      expect(qb.andWhere).toHaveBeenCalledWith(
        'custom.tenant_id = :__tenantId',
        { __tenantId: 'tenant-xyz' },
      );
    });

    it('throws when no tenant context is active', () => {
      const qb: any = { alias: 'e', andWhere: jest.fn() };
      expect(() => service.scopeQuery(qb)).toThrow();
    });
  });

  // ── scopeFindOptions ──────────────────────────────────────────────────────

  describe('scopeFindOptions', () => {
    it('injects tenant_id into a plain where object', () => {
      const result = withTenant('t1', () =>
        service.scopeFindOptions({ id: '123' }),
      );
      expect(result).toMatchObject({ id: '123', tenant_id: 't1' });
    });

    it('injects tenant_id into each element of an array', () => {
      const result = withTenant('t2', () =>
        service.scopeFindOptions([{ id: 'a' }, { id: 'b' }]),
      ) as any[];
      expect(result).toHaveLength(2);
      expect(result[0]).toMatchObject({ tenant_id: 't2' });
      expect(result[1]).toMatchObject({ tenant_id: 't2' });
    });
  });

  // ── assertTenantOwnership ─────────────────────────────────────────────────

  describe('assertTenantOwnership', () => {
    it('does not throw when tenantIds match', () => {
      withTenant('t1', () => {
        expect(() => service.assertTenantOwnership('t1')).not.toThrow();
      });
    });

    it('throws ForbiddenException when tenantIds differ', () => {
      withTenant('t1', () => {
        expect(() => service.assertTenantOwnership('t2')).toThrow(
          ForbiddenException,
        );
      });
    });
  });

  // ── unscopedQuery ─────────────────────────────────────────────────────────

  describe('unscopedQuery', () => {
    it('executes callback and emits audit event for SUPER_ADMIN', async () => {
      const fn = jest.fn().mockResolvedValue('result');
      const result = await withTenant('t1', () =>
        service.unscopedQuery('SUPER_ADMIN', 'admin report', fn),
      );

      expect(result).toBe('result');
      expect(emitter.emit).toHaveBeenCalledWith(
        'tenant.unscoped_access',
        expect.objectContaining({ reason: 'admin report' }),
      );
    });

    it('throws ForbiddenException for non-SUPER_ADMIN callers', async () => {
      await expect(
        withTenant('t1', () =>
          service.unscopedQuery('ADMIN', 'reason', jest.fn()),
        ),
      ).rejects.toThrow(ForbiddenException);
    });
  });
});
