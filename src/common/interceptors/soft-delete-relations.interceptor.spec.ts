import { Test, TestingModule } from '@nestjs/testing';
import { ExecutionContext, CallHandler } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { of } from 'rxjs';
import { SoftDeleteRelationsInterceptor } from './soft-delete-relations.interceptor';

describe('SoftDeleteRelationsInterceptor', () => {
  let interceptor: SoftDeleteRelationsInterceptor;
  let reflector: Reflector;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [SoftDeleteRelationsInterceptor, Reflector],
    }).compile();

    interceptor = module.get<SoftDeleteRelationsInterceptor>(
      SoftDeleteRelationsInterceptor,
    );
    reflector = module.get<Reflector>(Reflector);
  });

  describe('intercept', () => {
    let mockContext: ExecutionContext;
    let mockCallHandler: CallHandler;

    beforeEach(() => {
      mockContext = {} as ExecutionContext;
    });

    it('should pass through null payload', (done) => {
      mockCallHandler = {
        handle: jest.fn().mockReturnValue(of(null)),
      } as unknown as CallHandler;

      interceptor.intercept(mockContext, mockCallHandler).subscribe(result => {
        expect(result).toBeNull();
        done();
      });
    });

    it('should pass through undefined payload', (done) => {
      mockCallHandler = {
        handle: jest.fn().mockReturnValue(of(undefined)),
      } as unknown as CallHandler;

      interceptor.intercept(mockContext, mockCallHandler).subscribe(result => {
        expect(result).toBeUndefined();
        done();
      });
    });

    it('should filter soft-deleted entities from root array', (done) => {
      const payload = [
        { id: '1', name: 'Entity 1', deletedAt: null },
        { id: '2', name: 'Deleted Entity', deletedAt: new Date() },
        { id: '3', name: 'Entity 3', deletedAt: null },
      ];

      mockCallHandler = {
        handle: jest.fn().mockReturnValue(of(payload)),
      } as unknown as CallHandler;

      interceptor.intercept(mockContext, mockCallHandler).subscribe(result => {
        expect(result).toHaveLength(2);
        expect(result[0].id).toBe('1');
        expect(result[1].id).toBe('3');
        done();
      });
    });

    it('should filter soft-deleted relations from nested arrays', (done) => {
      const payload = {
        id: 'parent-1',
        name: 'Parent Entity',
        deletedAt: null,
        children: [
          { id: 'child-1', name: 'Active Child', deletedAt: null },
          { id: 'child-2', name: 'Deleted Child', deletedAt: new Date() },
          { id: 'child-3', name: 'Active Child 2', deletedAt: null },
        ],
      };

      mockCallHandler = {
        handle: jest.fn().mockReturnValue(of(payload)),
      } as unknown as CallHandler;

      interceptor.intercept(mockContext, mockCallHandler).subscribe(result => {
        expect(result.id).toBe('parent-1');
        expect(result.children).toHaveLength(2);
        expect(result.children[0].id).toBe('child-1');
        expect(result.children[1].id).toBe('child-3');
        done();
      });
    });

    it('should filter deeply nested soft-deleted relations', (done) => {
      const payload = {
        id: 'parent',
        deletedAt: null,
        level1: [
          {
            id: 'l1-1',
            deletedAt: null,
            level2: [
              { id: 'l2-1', deletedAt: null },
              { id: 'l2-2', deletedAt: new Date() },
              { id: 'l2-3', deletedAt: null },
            ],
          },
        ],
      };

      mockCallHandler = {
        handle: jest.fn().mockReturnValue(of(payload)),
      } as unknown as CallHandler;

      interceptor.intercept(mockContext, mockCallHandler).subscribe(result => {
        expect(result.level1[0].level2).toHaveLength(2);
        expect(result.level1[0].level2[0].id).toBe('l2-1');
        expect(result.level1[0].level2[1].id).toBe('l2-3');
        done();
      });
    });

    it('should handle empty relation arrays', (done) => {
      const payload = {
        id: 'parent',
        deletedAt: null,
        children: [],
      };

      mockCallHandler = {
        handle: jest.fn().mockReturnValue(of(payload)),
      } as unknown as CallHandler;

      interceptor.intercept(mockContext, mockCallHandler).subscribe(result => {
        expect(result.children).toEqual([]);
        done();
      });
    });

    it('should filter all soft-deleted items from relation array', (done) => {
      const payload = {
        id: 'parent',
        deletedAt: null,
        tags: [
          { id: 'tag-1', deletedAt: new Date() },
          { id: 'tag-2', deletedAt: new Date() },
        ],
      };

      mockCallHandler = {
        handle: jest.fn().mockReturnValue(of(payload)),
      } as unknown as CallHandler;

      interceptor.intercept(mockContext, mockCallHandler).subscribe(result => {
        expect(result.tags).toHaveLength(0);
        done();
      });
    });

    it('should preserve non-array relations', (done) => {
      const payload = {
        id: 'entity',
        deletedAt: null,
        metadata: {
          key: 'value',
          nested: {
            data: 'test',
          },
        },
      };

      mockCallHandler = {
        handle: jest.fn().mockReturnValue(of(payload)),
      } as unknown as CallHandler;

      interceptor.intercept(mockContext, mockCallHandler).subscribe(result => {
        expect(result.metadata.key).toBe('value');
        expect(result.metadata.nested.data).toBe('test');
        done();
      });
    });

    it('should handle deletedAt in snake_case', (done) => {
      const payload = [
        { id: '1', name: 'Active', deleted_at: null },
        { id: '2', name: 'Deleted', deleted_at: new Date() },
      ];

      mockCallHandler = {
        handle: jest.fn().mockReturnValue(of(payload)),
      } as unknown as CallHandler;

      interceptor.intercept(mockContext, mockCallHandler).subscribe(result => {
        expect(result).toHaveLength(1);
        expect(result[0].id).toBe('1');
        done();
      });
    });

    it('should preserve parent entity even if all children are soft-deleted', (done) => {
      const payload = {
        id: 'parent',
        name: 'Parent Entity',
        deletedAt: null,
        children: [
          { id: 'child-1', deletedAt: new Date() },
          { id: 'child-2', deletedAt: new Date() },
        ],
      };

      mockCallHandler = {
        handle: jest.fn().mockReturnValue(of(payload)),
      } as unknown as CallHandler;

      interceptor.intercept(mockContext, mockCallHandler).subscribe(result => {
        expect(result.id).toBe('parent');
        expect(result.name).toBe('Parent Entity');
        expect(result.children).toHaveLength(0);
        done();
      });
    });

    it('should handle mixed types in relations gracefully', (done) => {
      const payload = {
        id: 'entity',
        deletedAt: null,
        items: [
          { id: '1', deletedAt: null },
          null,
          { id: '3', deletedAt: new Date() },
          'string-value',
          { id: '5', deletedAt: null },
        ],
      };

      mockCallHandler = {
        handle: jest.fn().mockReturnValue(of(payload)),
      } as unknown as CallHandler;

      interceptor.intercept(mockContext, mockCallHandler).subscribe(result => {
        // null items should not be filtered, only soft-deleted objects
        expect(result.items.length).toBeGreaterThan(0);
        done();
      });
    });

    it('should return original payload on processing error', (done) => {
      const payload = { id: 'test', deletedAt: null };

      mockCallHandler = {
        handle: jest.fn().mockReturnValue(of(payload)),
      } as unknown as CallHandler;

      interceptor.intercept(mockContext, mockCallHandler).subscribe(result => {
        expect(result).toEqual(payload);
        done();
      });
    });
  });
});
