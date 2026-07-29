import { ExecutionContext, CallHandler } from '@nestjs/common';
import { of } from 'rxjs';
import { StripInternalFieldsInterceptor } from './strip-internal-fields.interceptor';
import { Internal } from '../decorators/internal.decorator';

describe('StripInternalFieldsInterceptor', () => {
  let interceptor: StripInternalFieldsInterceptor;
  let mockContext: ExecutionContext;
  let mockNext: CallHandler;

  beforeEach(() => {
    interceptor = new StripInternalFieldsInterceptor();
    mockContext = {} as ExecutionContext;
  });

  it('should remove internal fields from a single object', (done) => {
    class UserEntity {
      id: string;
      name: string;

      @Internal()
      internalRiskScore: number;
    }

    const user = new UserEntity();
    user.id = '123';
    user.name = 'John';
    user.internalRiskScore = 95;

    mockNext = {
      handle: () => of(user),
    } as CallHandler;

    interceptor.intercept(mockContext, mockNext).subscribe((result) => {
      expect(result.id).toBe('123');
      expect(result.name).toBe('John');
      expect(result.internalRiskScore).toBeUndefined();
      done();
    });
  });

  it('should remove internal fields from array of objects', (done) => {
    class TradeEntity {
      id: string;
      amount: number;

      @Internal()
      internalProfitMargin: number;
    }

    const trades = [
      Object.assign(new TradeEntity(), {
        id: '1',
        amount: 100,
        internalProfitMargin: 45,
      }),
      Object.assign(new TradeEntity(), {
        id: '2',
        amount: 200,
        internalProfitMargin: 50,
      }),
    ];

    mockNext = {
      handle: () => of(trades),
    } as CallHandler;

    interceptor.intercept(mockContext, mockNext).subscribe((result) => {
      expect(Array.isArray(result)).toBe(true);
      expect(result).toHaveLength(2);
      expect(result[0].id).toBe('1');
      expect(result[0].internalProfitMargin).toBeUndefined();
      expect(result[1].id).toBe('2');
      expect(result[1].internalProfitMargin).toBeUndefined();
      done();
    });
  });

  it('should handle nested objects with internal fields', (done) => {
    class WalletEntity {
      address: string;

      @Internal()
      privateKey: string;
    }

    class AccountEntity {
      id: string;
      wallet: WalletEntity;

      @Internal()
      internalFlag: boolean;
    }

    const account = new AccountEntity();
    account.id = 'acc-1';
    account.internalFlag = true;
    account.wallet = new WalletEntity();
    account.wallet.address = '0x123';
    account.wallet.privateKey = 'secret';

    mockNext = {
      handle: () => of(account),
    } as CallHandler;

    interceptor.intercept(mockContext, mockNext).subscribe((result) => {
      expect(result.id).toBe('acc-1');
      expect(result.internalFlag).toBeUndefined();
      expect(result.wallet.address).toBe('0x123');
      expect(result.wallet.privateKey).toBeUndefined();
      done();
    });
  });

  it('should handle plain objects without @Internal() decorator', (done) => {
    const plainObject = {
      id: '123',
      name: 'Test',
    };

    mockNext = {
      handle: () => of(plainObject),
    } as CallHandler;

    interceptor.intercept(mockContext, mockNext).subscribe((result) => {
      expect(result.id).toBe('123');
      expect(result.name).toBe('Test');
      done();
    });
  });

  it('should handle null and undefined payloads', (done) => {
    mockNext = {
      handle: () => of(null),
    } as CallHandler;

    interceptor.intercept(mockContext, mockNext).subscribe((result) => {
      expect(result).toBeNull();
      done();
    });
  });

  it('should handle primitive values', (done) => {
    mockNext = {
      handle: () => of(42),
    } as CallHandler;

    interceptor.intercept(mockContext, mockNext).subscribe((result) => {
      expect(result).toBe(42);
      done();
    });
  });

  it('should handle multiple internal fields on same object', (done) => {
    class SecureEntity {
      id: string;

      @Internal()
      field1: string;

      @Internal()
      field2: string;

      @Internal()
      field3: string;

      publicField: string;
    }

    const entity = new SecureEntity();
    entity.id = '1';
    entity.field1 = 'secret1';
    entity.field2 = 'secret2';
    entity.field3 = 'secret3';
    entity.publicField = 'public';

    mockNext = {
      handle: () => of(entity),
    } as CallHandler;

    interceptor.intercept(mockContext, mockNext).subscribe((result) => {
      expect(result.id).toBe('1');
      expect(result.publicField).toBe('public');
      expect(result.field1).toBeUndefined();
      expect(result.field2).toBeUndefined();
      expect(result.field3).toBeUndefined();
      done();
    });
  });

  it('should process response envelope format with internal fields', (done) => {
    class UserEntity {
      id: string;

      @Internal()
      internalRiskScore: number;
    }

    const user = new UserEntity();
    user.id = '123';
    user.internalRiskScore = 95;

    const envelope = {
      data: user,
      meta: {
        timestamp: '2026-06-29T00:00:00Z',
      },
    };

    mockNext = {
      handle: () => of(envelope),
    } as CallHandler;

    interceptor.intercept(mockContext, mockNext).subscribe((result) => {
      expect(result.data.id).toBe('123');
      expect(result.data.internalRiskScore).toBeUndefined();
      expect(result.meta.timestamp).toBe('2026-06-29T00:00:00Z');
      done();
    });
  });
});
