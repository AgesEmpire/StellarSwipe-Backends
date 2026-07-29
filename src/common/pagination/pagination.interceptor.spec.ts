import { Test, TestingModule } from '@nestjs/testing';
import { PaginationInterceptor } from './pagination.interceptor';
import { ExecutionContext, CallHandler } from '@nestjs/common';
import { of } from 'rxjs';

describe('PaginationInterceptor', () => {
  let interceptor: PaginationInterceptor;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [PaginationInterceptor],
    }).compile();

    interceptor = module.get<PaginationInterceptor>(PaginationInterceptor);
  });

  it('should be defined', () => {
    expect(interceptor).toBeDefined();
  });

  it('should paginate array data', (done) => {
    const mockContext = {
      switchToHttp: () => ({
        getRequest: () => ({
          query: { page: '2', limit: '5' },
        }),
      }),
    } as ExecutionContext;

    const mockData = Array.from({ length: 15 }, (_, i) => ({ id: i + 1 }));
    const mockCallHandler = {
      handle: () => of(mockData),
    } as CallHandler;

    interceptor.intercept(mockContext, mockCallHandler).subscribe((result) => {
      expect(result.data).toHaveLength(5);
      expect(result.data[0].id).toBe(6); // Second page starts at index 5
      expect(result.pagination).toEqual({
        page: 2,
        limit: 5,
        total: 15,
        totalPages: 3,
        hasNext: true,
        hasPrev: true,
      });
      done();
    });
  });

  it('should handle first page correctly', (done) => {
    const mockContext = {
      switchToHttp: () => ({
        getRequest: () => ({
          query: { page: '1', limit: '10' },
        }),
      }),
    } as ExecutionContext;

    const mockData = Array.from({ length: 25 }, (_, i) => ({ id: i + 1 }));
    const mockCallHandler = {
      handle: () => of(mockData),
    } as CallHandler;

    interceptor.intercept(mockContext, mockCallHandler).subscribe((result) => {
      expect(result.data).toHaveLength(10);
      expect(result.data[0].id).toBe(1);
      expect(result.pagination.hasPrev).toBe(false);
      expect(result.pagination.hasNext).toBe(true);
      done();
    });
  });

  it('should handle last page correctly', (done) => {
    const mockContext = {
      switchToHttp: () => ({
        getRequest: () => ({
          query: { page: '3', limit: '10' },
        }),
      }),
    } as ExecutionContext;

    const mockData = Array.from({ length: 25 }, (_, i) => ({ id: i + 1 }));
    const mockCallHandler = {
      handle: () => of(mockData),
    } as CallHandler;

    interceptor.intercept(mockContext, mockCallHandler).subscribe((result) => {
      expect(result.data).toHaveLength(5); // 25 total, 3 pages of 10, last page has 5
      expect(result.data[0].id).toBe(21);
      expect(result.pagination.hasNext).toBe(false);
      expect(result.pagination.hasPrev).toBe(true);
      done();
    });
  });

  it('should use default values when no query params', (done) => {
    const mockContext = {
      switchToHttp: () => ({
        getRequest: () => ({
          query: {},
        }),
      }),
    } as ExecutionContext;

    const mockData = Array.from({ length: 50 }, (_, i) => ({ id: i + 1 }));
    const mockCallHandler = {
      handle: () => of(mockData),
    } as CallHandler;

    interceptor.intercept(mockContext, mockCallHandler).subscribe((result) => {
      expect(result.data).toHaveLength(20); // Default limit
      expect(result.pagination.page).toBe(1);
      expect(result.pagination.limit).toBe(20);
      done();
    });
  });

  it('should enforce maximum limit', (done) => {
    const mockContext = {
      switchToHttp: () => ({
        getRequest: () => ({
          query: { limit: '200' },
        }),
      }),
    } as ExecutionContext;

    const mockData = Array.from({ length: 150 }, (_, i) => ({ id: i + 1 }));
    const mockCallHandler = {
      handle: () => of(mockData),
    } as CallHandler;

    interceptor.intercept(mockContext, mockCallHandler).subscribe((result) => {
      expect(result.pagination.limit).toBe(100); // Max limit enforced
      done();
    });
  });

  it('should return non-array data unchanged', (done) => {
    const mockContext = {
      switchToHttp: () => ({
        getRequest: () => ({
          query: {},
        }),
      }),
    } as ExecutionContext;

    const mockData = { message: 'Hello World' };
    const mockCallHandler = {
      handle: () => of(mockData),
    } as CallHandler;

    interceptor.intercept(mockContext, mockCallHandler).subscribe((result) => {
      expect(result).toEqual(mockData);
      done();
    });
  });

  it('should return existing paginated response unchanged', (done) => {
    const mockContext = {
      switchToHttp: () => ({
        getRequest: () => ({
          query: {},
        }),
      }),
    } as ExecutionContext;

    const mockData = {
      data: [{ id: 1 }],
      pagination: { page: 1, limit: 10 },
    };
    const mockCallHandler = {
      handle: () => of(mockData),
    } as CallHandler;

    interceptor.intercept(mockContext, mockCallHandler).subscribe((result) => {
      expect(result).toEqual(mockData);
      done();
    });
  });
});