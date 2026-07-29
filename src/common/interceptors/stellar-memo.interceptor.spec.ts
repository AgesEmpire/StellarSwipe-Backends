import { Test, TestingModule } from '@nestjs/testing';
import { ExecutionContext } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { StellarMemoInterceptor } from './stellar-memo.interceptor';
import { STELLAR_MEMO_FIELD_KEY } from '../decorators/stellar-memo.decorator';
import { of } from 'rxjs';

describe('StellarMemoInterceptor', () => {
  let interceptor: StellarMemoInterceptor;
  let reflector: Reflector;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [StellarMemoInterceptor, Reflector],
    }).compile();

    interceptor = module.get<StellarMemoInterceptor>(StellarMemoInterceptor);
    reflector = module.get<Reflector>(Reflector);
  });

  describe('intercept', () => {
    it('should decode text memo from base64', (done) => {
      const mockContext = {
        getHandler: jest.fn(),
      } as unknown as ExecutionContext;

      jest.spyOn(reflector, 'get').mockReturnValue(true);

      const mockHandler = {
        handle: () => of({
          memo: Buffer.from('Hello World').toString('base64'),
        }),
      };

      interceptor.intercept(mockContext, mockHandler).subscribe((result) => {
        expect(result.memo).toEqual({
          type: 'text',
          value: 'Hello World',
        });
        done();
      });
    });

    it('should decode text memo from raw string', (done) => {
      const mockContext = {
        getHandler: jest.fn(),
      } as unknown as ExecutionContext;

      jest.spyOn(reflector, 'get').mockReturnValue(true);

      const mockHandler = {
        handle: () => of({
          memo: 'Test Memo',
        }),
      };

      interceptor.intercept(mockContext, mockHandler).subscribe((result) => {
        expect(result.memo).toEqual({
          type: 'text',
          value: 'Test Memo',
        });
        done();
      });
    });

    it('should decode memo ID from object', (done) => {
      const mockContext = {
        getHandler: jest.fn(),
      } as unknown as ExecutionContext;

      jest.spyOn(reflector, 'get').mockReturnValue(true);

      const mockHandler = {
        handle: () => of({
          memo: {
            _arm_type: 2,
            id: '1234567890',
          },
        }),
      };

      interceptor.intercept(mockContext, mockHandler).subscribe((result) => {
        expect(result.memo).toEqual({
          type: 'id',
          value: 1234567890,
        });
        done();
      });
    });

    it('should decode memo hash from object', (done) => {
      const mockContext = {
        getHandler: jest.fn(),
      } as unknown as ExecutionContext;

      jest.spyOn(reflector, 'get').mockReturnValue(true);

      const hashBuffer = Buffer.from('abcd1234');
      const mockHandler = {
        handle: () => of({
          memo: {
            _arm_type: 3,
            hash: hashBuffer,
          },
        }),
      };

      interceptor.intercept(mockContext, mockHandler).subscribe((result) => {
        expect(result.memo.type).toEqual('hash');
        expect(result.memo.value).toEqual(hashBuffer.toString('base64'));
        done();
      });
    });

    it('should handle memo type NONE', (done) => {
      const mockContext = {
        getHandler: jest.fn(),
      } as unknown as ExecutionContext;

      jest.spyOn(reflector, 'get').mockReturnValue(true);

      const mockHandler = {
        handle: () => of({
          memo: {
            _arm_type: 0,
          },
        }),
      };

      interceptor.intercept(mockContext, mockHandler).subscribe((result) => {
        expect(result.memo).toEqual({
          type: 'none',
          value: null,
        });
        done();
      });
    });

    it('should process nested memo fields in arrays', (done) => {
      const mockContext = {
        getHandler: jest.fn(),
      } as unknown as ExecutionContext;

      jest.spyOn(reflector, 'get').mockReturnValue(true);

      const mockHandler = {
        handle: () => of([
          { id: '1', memo: 'Memo1' },
          { id: '2', memo: 'Memo2' },
        ]),
      };

      interceptor.intercept(mockContext, mockHandler).subscribe((result) => {
        expect(Array.isArray(result)).toBe(true);
        expect(result[0].memo).toEqual({
          type: 'text',
          value: 'Memo1',
        });
        expect(result[1].memo).toEqual({
          type: 'text',
          value: 'Memo2',
        });
        done();
      });
    });

    it('should skip processing when decorator not present', (done) => {
      const mockContext = {
        getHandler: jest.fn(),
      } as unknown as ExecutionContext;

      jest.spyOn(reflector, 'get').mockReturnValue(false);

      const originalData = { memo: Buffer.from('test').toString('base64') };
      const mockHandler = {
        handle: () => of(originalData),
      };

      interceptor.intercept(mockContext, mockHandler).subscribe((result) => {
        expect(result).toEqual(originalData);
        done();
      });
    });

    it('should handle already decoded memo format', (done) => {
      const mockContext = {
        getHandler: jest.fn(),
      } as unknown as ExecutionContext;

      jest.spyOn(reflector, 'get').mockReturnValue(true);

      const mockHandler = {
        handle: () => of({
          memo: {
            type: 'text',
            value: 'Already decoded',
          },
        }),
      };

      interceptor.intercept(mockContext, mockHandler).subscribe((result) => {
        expect(result.memo).toEqual({
          type: 'text',
          value: 'Already decoded',
        });
        done();
      });
    });
  });
});
